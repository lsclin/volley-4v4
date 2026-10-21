import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { createFourVFourClient } from "../../src/lib/four-v-four/database.ts";
import { migrateFourVFour } from "../../src/lib/four-v-four/migrate.ts";
import { readPublicSchedule } from "../../src/lib/four-v-four/repository.ts";
import { calculateGroupStandings, courtBoard, determinedTeamMatches, scoreView } from "../../src/lib/four-v-four/public-logic.ts";
import type { PublicMatch, PublicTeam } from "../../src/lib/four-v-four/public-types.ts";
import { prepareReviewFixture } from "../fixtures/review.ts";
import type { ReviewScenario } from "../fixtures/review.ts";

async function fixture(t: TestContext, mode: 8 | 10, scenario: ReviewScenario = "live") {
  const directory = await mkdtemp(path.join(process.env.FOUR_V_FOUR_TEST_ROOT!, "public-"));
  const url = `file:${path.join(directory, "event.db")}`;
  await migrateFourVFour({ FOUR_V_FOUR_DATABASE_URL: url });
  const db = createFourVFourClient(url);
  t.after(async () => { await db.$disconnect(); });
  await prepareReviewFixture(db, mode, scenario);
  const data = await readPublicSchedule(db);
  if (data.publication !== "published") throw new Error("Fixture should be published");
  return { db, data };
}

for (const mode of [8, 10] as const) {
  test(`${mode}队公开端：实际比分、每组6/10场、双场地独立状态及未确认交叉赛隐藏`, async (t) => {
    const { data } = await fixture(t, mode);
    assert.equal(data.matches.filter((m) => m.group === "A").length, mode === 8 ? 6 : 10);
    assert.equal(courtBoard(data.matches, "main").current?.code, "M03");
    assert.equal(courtBoard(data.matches, "secondary").current?.code, "M02");
    assert.equal(scoreView(courtBoard(data.matches, "main").current!).primary, "18 : 16");
    assert.ok(data.matches.filter((m) => m.stage !== "GROUP").every((m) => !m.home.team && !m.away.team && m.sets.length === 0));
    assert.equal(data.groups[0].rows.reduce((count, row) => count + row.played, 0), 2); // Live games do not count.
    assert.equal(data.groups[1].rows.reduce((count, row) => count + row.played, 0), 0);
  });
  test(`${mode}队首页方案A：主场空档保留结果与下一场、副场仍直播`, async (t) => {
    const { data } = await fixture(t, mode, "interval");
    const main = courtBoard(data.matches, "main"), other = courtBoard(data.matches, "secondary");
    assert.equal(main.current, null); assert.equal(main.primary?.code, "M03"); assert.equal(main.next?.code, "M05");
    assert.equal(scoreView(main.primary!).primary, "25 : 22"); assert.equal(other.current?.code, "M02");
  });
  test(`${mode}队BO3与树图：总局分、当前局分、半决赛已提交胜者联动且不猜另一个胜者`, async (t) => {
    const { data } = await fixture(t, mode, "cross");
    const live = data.matches.find((m) => m.stage === "SEMIFINAL" && m.status === "LIVE")!;
    assert.equal(scoreView(live).primary, "1 : 0"); assert.equal(scoreView(live).current?.homePoints, 10);
    const final = data.matches.find((m) => m.stage === "FINAL")!;
    assert.ok(final.home.team); assert.equal(final.away.team, null);
    const own = determinedTeamMatches(data.matches, final.home.team.drawCode);
    assert.ok(own.every((match) => match.code !== final.code)); // The opponent is not yet determined.
    assert.equal(own[0].stage, "GROUP");
    const third = data.matches.find((m) => m.stage === "THIRD_PLACE")!;
    assert.ok(third.home.team); assert.notEqual(third.home.team.drawCode, final.home.team.drawCode);
    assert.equal(third.away.team, null);
  });
  test(`${mode}队最终名次：全赛结束未确认不泄露；确认后完整；成绩版本改变立即隐藏`, async (t) => {
    const { db, data } = await fixture(t, mode, "final-published");
    assert.equal(data.finalPublished, true); assert.equal(data.finalStandings.length, mode);
    assert.deepEqual(data.finalStandings.map((row) => row.rank), Array.from({ length: mode }, (_, i) => i + 1));
    await db.approval.deleteMany({ where: { type: "FINAL" } });
    const pending = await readPublicSchedule(db); if (pending.publication !== "published") assert.fail();
    assert.equal(pending.allFinished, true); assert.deepEqual(pending.finalStandings, []); assert.equal(pending.finalPublished, false);
    await db.approval.create({ data: { type: "FINAL", sourceRevision: mode === 8 ? 18 : 27, snapshot: JSON.stringify({ rankings: data.finalStandings }), approvedBy: "test" } });
    await db.tournament.update({ where: { id: "current" }, data: { resultsRevision: { increment: 1 } } });
    const stale = await readPublicSchedule(db); if (stale.publication !== "published") assert.fail();
    assert.deepEqual(stale.finalStandings, []); assert.equal(stale.finalPublished, false);
  });
}

test("首页：未开打显示下一场，全部完成显示最后结果", async (t) => {
  const { data } = await fixture(t, 8, "upcoming");
  const upcoming = courtBoard(data.matches, "main");
  assert.equal(upcoming.current, null); assert.equal(upcoming.previous, null); assert.equal(upcoming.primary?.code, "M01");
  const { data: completed } = await fixture(t, 8, "final-pending");
  const done = courtBoard(completed.matches, "main");
  assert.equal(done.complete, true); assert.equal(done.next, null); assert.equal(done.primary?.stage, "FINAL");
});

test("上一场按实际提交先后选择，管理员越序比赛不按最大队列号冒充最近结果", async (t) => {
  const { data } = await fixture(t, 8, "interval");
  const m1 = data.matches.find((m) => m.code === "M01")!;
  m1.submittedAt = "2026-10-15T03:00:00Z";
  assert.equal(courtBoard(data.matches, "main").previous?.code, "M01");
});

test("公开记录白名单：不含访问码、操作人、审计、原始确认快照；保留排除局但不计总局分", async (t) => {
  const { db } = await fixture(t, 8, "cross");
  const semi = await db.match.findFirstOrThrow({ where: { stage: "SEMIFINAL", status: "FINISHED" } });
  await db.setScore.update({ where: { matchId_setIndex: { matchId: semi.id, setIndex: 2 } }, data: { homePoints: 15, awayPoints: 11 } });
  await db.setScore.update({ where: { matchId_setIndex: { matchId: semi.id, setIndex: 3 } }, data: { excluded: true, exclusionReason: "private audit explanation" } });
  await db.credential.create({ data: { role: "ADMIN", codeHash: "secret-code-hash" } });
  const data = await readPublicSchedule(db); if (data.publication !== "published") assert.fail();
  const match = data.matches.find((m) => m.code === semi.code)!;
  assert.equal(match.sets.length, 3); assert.equal(match.sets[2].excluded, true); assert.equal(scoreView(match).primary, "2 : 0");
  for (const forbidden of ["codeHash", "secret-code-hash", "approvedBy", "snapshot", "AuditLog", "exclusionReason", "private audit explanation"]) assert.ok(!JSON.stringify(data).includes(forbidden));
});

test("错误最终确认快照不能公开名次，即使版本匹配", async (t) => {
  const { db } = await fixture(t, 8, "final-published");
  await db.approval.updateMany({ where: { type: "FINAL" }, data: { snapshot: '{"rankings":[{"rank":1,"drawCode":"A1"}]}' } });
  const data = await readPublicSchedule(db); if (data.publication !== "published") assert.fail();
  assert.equal(data.finalPublished, false); assert.deepEqual(data.finalStandings, []);
});

const teams: PublicTeam[] = ["A1", "A2", "A3", "A4"].map((drawCode) => ({ drawCode, name: drawCode, group: "A" }));
function game(code: string, home: string, away: string, hp: number, ap: number): PublicMatch {
  return { code, stage: "GROUP", group: "A", placement: null, courtId: "main", sequence: 1, format: "BO1", targetPoints: 25, capPoints: 29,
    status: "FINISHED", submittedAt: "2026-10-15T01:00:00Z", needsReview: false, home: { ref: `team:${home}`, team: { drawCode: home, name: home } }, away: { ref: `team:${away}`, team: { drawCode: away, name: away } },
    winner: hp > ap ? home : away, sets: [{ setIndex: 1, homePoints: hp, awayPoints: ap, confirmed: true, excluded: false }] };
}
test("两队同胜场优先直接交手，全组净胜分更高也不能越过直接交手", () => {
  const matches = [game("1", "A1", "A2", 25, 24), game("2", "A1", "A3", 0, 25), game("3", "A2", "A3", 25, 0), game("4", "A3", "A4", 25, 20)];
  const rows = calculateGroupStandings(teams, matches, "A").rows.filter((row) => ["A1", "A2"].includes(row.drawCode));
  assert.equal(rows[0].drawCode, "A1"); assert.equal(rows[1].drawCode, "A2");
});
test("三队循环同胜场缩为两队同指标时不递归重比直接交手", () => {
  const matches = [game("1", "A1", "A2", 25, 23), game("2", "A2", "A3", 25, 24), game("3", "A3", "A1", 25, 22), game("4", "A1", "A4", 25, 24), game("5", "A2", "A4", 25, 20), game("6", "A3", "A4", 25, 24)];
  assert.deepEqual(calculateGroupStandings(teams, matches, "A").rows.map((row) => row.drawCode), ["A3", "A2", "A1", "A4"]);
});
test("所有指标相同保留并列，不随机分配不同名次", () => {
  const result = calculateGroupStandings(teams, [], "A");
  assert.ok(result.unresolved); assert.ok(result.rows.every((row) => row.rank === 1 && row.tied)); assert.equal(result.complete, false);
});
test("BO3人工确认局且达到两胜待提交时不自动生成第四局或计入多余局", () => {
  const match = game("M13", "A1", "A2", 15, 11); match.format = "BO3"; match.status = "LIVE"; match.submittedAt = null;
  match.sets.push({ setIndex: 2, homePoints: 15, awayPoints: 13, confirmed: true, excluded: false }, { setIndex: 3, homePoints: 16, awayPoints: 18, confirmed: true, excluded: true });
  const view = scoreView(match); assert.equal(view.primary, "2 : 0"); assert.equal(view.current, null);
  match.sets[2].excluded = false; match.sets[2].confirmed = false;
  assert.equal(scoreView(match).current, null); // A leftover raw third set must not restart play after two wins.
});
