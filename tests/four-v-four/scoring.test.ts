import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { createFourVFourClient } from "../../src/lib/four-v-four/database.ts";
import { migrateFourVFour } from "../../src/lib/four-v-four/migrate.ts";
import { authenticateAccessCode, hashAccessCode, setAccessCode, verifyAccessCode } from "../../src/lib/four-v-four/credentials.ts";
import { performScoreAction, readScoringDesk, readStaffMatch } from "../../src/lib/four-v-four/scoring-service.ts";
import { readPublicSchedule } from "../../src/lib/four-v-four/repository.ts";
import { ScoringError } from "../../src/lib/four-v-four/scoring-types.ts";
import type { Principal, ScoreAction, ScoreCommand } from "../../src/lib/four-v-four/scoring-types.ts";
import type { PublicMatch } from "../../src/lib/four-v-four/public-types.ts";
import { prepareReviewFixture } from "../fixtures/review.ts";

const isError = (code: string) => (error: unknown) => error instanceof ScoringError && error.code === code;
async function fixture(t: TestContext, bo3 = false, mode: 8 | 10 = 8) {
  const directory = await mkdtemp(path.join(process.env.FOUR_V_FOUR_TEST_ROOT!, "scoring-"));
  const url = `file:${path.join(directory, "event.db")}`; await migrateFourVFour({ FOUR_V_FOUR_DATABASE_URL: url });
  const db = createFourVFourClient(url); t.after(async () => { await db.$disconnect(); });
  await prepareReviewFixture(db, mode, bo3 ? "cross-upcoming" : "upcoming");
  const actors: Record<string, Principal> = {};
  for (const target of ["main", "secondary", "admin"] as const) {
    const { id, version, role, courtId } = await setAccessCode(db, target, `review-${target}-code`);
    actors[target] = { id, version, role, courtId };
  }
  const matchCode = bo3 ? mode === 8 ? "M13" : "M21" : "M01";
  let version = 0;
  const send = async (action: ScoreAction, actor = actors.main, code = matchCode) => {
    const result = await performScoreAction(db, actor, code, { requestId: randomUUID(), expectedVersion: version, action }); version = result.match.version; return result;
  };
  return { db, url, actors, send, matchCode };
}

test("访问码为带随机盐的scrypt散列，统一识别身份；重置码撤销旧会话且不记录明文", async (t) => {
  const { db, actors } = await fixture(t);
  const first = await hashAccessCode("eight-char-test"); const second = await hashAccessCode("eight-char-test");
  assert.notEqual(first, second); assert.ok(await verifyAccessCode("eight-char-test", first)); assert.equal(await verifyAccessCode("wrong-code", first), false);
  assert.equal(await authenticateAccessCode(db, "wrong-code"), null);
  assert.equal((await authenticateAccessCode(db, "review-main-code"))!.courtId, "main");
  assert.equal((await authenticateAccessCode(db, "review-admin-code"))!.role, "ADMIN");
  await setAccessCode(db, "main", "replacement-main-code");
  assert.equal(await authenticateAccessCode(db, "review-main-code"), null);
  await assert.rejects(readScoringDesk(db, actors.main), isError("SESSION_EXPIRED"));
  const logs = await db.auditLog.findMany(); assert.ok(!JSON.stringify(logs).includes("replacement-main-code"));
});

test("授权场地在服务端强制校验，伪造court/actor不能获得另一场地或管理员权限", async (t) => {
  const { db, actors } = await fixture(t);
  const list = await readScoringDesk(db, actors.main); assert.ok(list.matches.every((match) => match.courtId === "main"));
  await assert.rejects(readStaffMatch(db, actors.main, "M02"), isError("FORBIDDEN"));
  await assert.rejects(performScoreAction(db, actors.main, "M02", { requestId: randomUUID(), expectedVersion: 0, action: { type: "START" } }), isError("FORBIDDEN"));
  await assert.rejects(readScoringDesk(db, { ...actors.main, role: "ADMIN", courtId: null }), isError("SESSION_EXPIRED"));
  assert.equal((await readStaffMatch(db, actors.admin, "M02")).courtId, "secondary");
});

test("BO1逐分和直接修改，不按25/29阈值自动结束；23:19提交立即生效并锁定", async (t) => {
  const { db, actors, send } = await fixture(t);
  await send({ type: "START" }); await send({ type: "POINT", setIndex: 1, side: "home", delta: 1 });
  let result = await send({ type: "SET_SCORE", setIndex: 1, homePoints: 35, awayPoints: 32 });
  assert.equal(result.match.status, "LIVE"); assert.equal(result.match.sets[0].confirmed, false);
  await send({ type: "SET_SCORE", setIndex: 1, homePoints: 23, awayPoints: 19 });
  result = await send({ type: "SUBMIT_MATCH" }); assert.equal(result.match.status, "FINISHED");
  const data = await readPublicSchedule(db); if (data.publication !== "published") assert.fail();
  assert.equal(data.matches.find((m) => m.code === "M01")!.winner, "A1"); assert.equal(data.groups[0].rows.find((team) => team.drawCode === "A1")!.wins, 1);
  assert.equal(await db.approval.count(), 0); // No per-match approval.
  await assert.rejects(send({ type: "SET_SCORE", setIndex: 1, homePoints: 24, awayPoints: 19 }), isError("MATCH_LOCKED"));
  await assert.rejects(performScoreAction(db, actors.main, "M01", { requestId: randomUUID(), expectedVersion: result.match.version, action: { type: "SUBMIT_MATCH" } }), isError("MATCH_LOCKED"));
});

test("同分与负数只作为完整性错误，不生成异常阈值或冲突警告", async (t) => {
  const { db, send } = await fixture(t); await send({ type: "START" });
  await assert.rejects(send({ type: "POINT", setIndex: 1, side: "home", delta: -1 }), isError("INVALID_POINTS"));
  await assert.rejects(send({ type: "SUBMIT_MATCH" }), isError("WINNER_REQUIRED"));
  assert.equal((await db.match.findUniqueOrThrow({ where: { id: "M01" } })).version, 1);
  await assert.rejects(send({ type: "SET_SCORE", setIndex: 1, homePoints: 1.5, awayPoints: 0 }), isError("INVALID_REQUEST"));
  await assert.rejects(send({ type: "SET_SCORE", setIndex: 2, homePoints: 1, awayPoints: 0 }), isError("INVALID_SET"));
});

for (const mode of [8, 10] as const) {
  test(`${mode}队BO3：人工结束局、下一局归零、1:1第三局、整场提交锁定`, async (t) => {
    const { db, send, matchCode } = await fixture(t, true, mode); await send({ type: "START" });
    await send({ type: "SET_SCORE", setIndex: 1, homePoints: 15, awayPoints: 12 });
    let result = await send({ type: "CONFIRM_SET", setIndex: 1 });
    assert.equal(result.match.sets[1].homePoints, 0); assert.equal(result.match.sets[0].confirmed, true); assert.ok(result.match.crossApprovalIdAtStart);
    await send({ type: "SET_SCORE", setIndex: 2, homePoints: 10, awayPoints: 15 }); await send({ type: "CONFIRM_SET", setIndex: 2 });
    await send({ type: "SET_SCORE", setIndex: 3, homePoints: 19, awayPoints: 18 });
    await assert.rejects(send({ type: "SUBMIT_MATCH" }), isError("INCOMPLETE_RESULT"));
    result = await send({ type: "CONFIRM_SET", setIndex: 3 }); assert.equal(result.match.sets.length, 3); assert.equal(result.match.status, "LIVE");
    result = await send({ type: "SUBMIT_MATCH" }); assert.equal(result.match.status, "FINISHED");
    assert.equal(await db.setScore.count({ where: { matchId: matchCode } }), 3);
  });
}

test("BO3历史修正成2:0保留第三局、排除记录与日志，可继续改排除局，再改回1:1可恢复第三局", async (t) => {
  const { db, send } = await fixture(t, true); await send({ type: "START" });
  for (const [index, hp, ap] of [[1, 15, 12], [2, 10, 15], [3, 15, 13]]) {
    await send({ type: "SET_SCORE", setIndex: index, homePoints: hp, awayPoints: ap }); await send({ type: "CONFIRM_SET", setIndex: index });
  }
  const rawThird = await db.setScore.findUniqueOrThrow({ where: { matchId_setIndex: { matchId: "M13", setIndex: 3 } } });
  let result = await send({ type: "SET_SCORE", setIndex: 2, homePoints: 15, awayPoints: 10 });
  assert.equal(result.match.sets[2].excluded, true); assert.equal(result.match.sets[2].homePoints, 15);
  assert.equal((await db.setScore.findUniqueOrThrow({ where: { id: rawThird.id } })).awayPoints, 13);
  await send({ type: "SET_SCORE", setIndex: 3, homePoints: 16, awayPoints: 14 });
  result = await send({ type: "SET_SCORE", setIndex: 2, homePoints: 10, awayPoints: 15 });
  assert.equal(result.match.sets[2].excluded, false); assert.equal(result.match.sets[2].homePoints, 16);
  await send({ type: "SUBMIT_MATCH" });
  const audits = await db.auditLog.findMany({ where: { operation: "SET_SCORE", subject: "M13" } });
  assert.ok(audits.some((log) => log.after!.includes('"excluded":true') && log.before!.includes('"awayPoints":13')));
});

test("2:0不建立第三局；历史修正为1:1后建立可记分第三局", async (t) => {
  const { send } = await fixture(t, true); await send({ type: "START" });
  for (const index of [1, 2]) { await send({ type: "SET_SCORE", setIndex: index, homePoints: 15, awayPoints: 11 }); await send({ type: "CONFIRM_SET", setIndex: index }); }
  let result = await send({ type: "SET_SCORE", setIndex: 2, homePoints: 11, awayPoints: 15 });
  assert.equal(result.match.sets.length, 3); assert.equal(result.match.sets[2].homePoints, 0); assert.equal(result.match.sets[2].confirmed, false);
  result = await send({ type: "SET_SCORE", setIndex: 2, homePoints: 15, awayPoints: 11 }); assert.equal(result.match.sets[2].excluded, true);
});

test("管理员原子修正已提交成绩，公开排名立即更新并使交叉及最终确认失效", async (t) => {
  const { db, send, actors } = await fixture(t); await send({ type: "START" }); await send({ type: "SET_SCORE", setIndex: 1, homePoints: 23, awayPoints: 19 });
  await send({ type: "SUBMIT_MATCH" });
  const tournament = await db.tournament.findUniqueOrThrow({ where: { id: "current" } });
  await db.approval.create({ data: { type: "CROSS", sourceRevision: tournament.groupResultsRevision, snapshot: "{}", approvedBy: "test" } });
  await db.approval.create({ data: { type: "FINAL", sourceRevision: tournament.resultsRevision, snapshot: "{}", approvedBy: "test" } });
  await send({ type: "CORRECT_RESULT", sets: [{ setIndex: 1, homePoints: 18, awayPoints: 23 }] }, actors.admin);
  const data = await readPublicSchedule(db); if (data.publication !== "published") assert.fail();
  assert.equal(data.matches.find((m) => m.code === "M01")!.winner, "A2"); assert.equal(data.crossPublished, false); assert.equal(data.crossNeedsReview, true);
  assert.equal(await db.approval.count({ where: { invalidatedAt: null } }), 0);
});

test("完全相同请求重复/迟到重试只应用一次，并返回当前版本而非旧快照", async (t) => {
  const { db, actors, send } = await fixture(t); await send({ type: "START" });
  const command: ScoreCommand = { requestId: randomUUID(), expectedVersion: 1, action: { type: "POINT", setIndex: 1, side: "home", delta: 1 } };
  await performScoreAction(db, actors.main, "M01", command);
  const second = await performScoreAction(db, actors.main, "M01", command); assert.equal(second.receipt.replayed, true); assert.equal(second.match.sets[0].homePoints, 1);
  await performScoreAction(db, actors.main, "M01", { ...command, requestId: randomUUID(), expectedVersion: 2 });
  const late = await performScoreAction(db, actors.main, "M01", command); assert.equal(late.match.version, 3); assert.equal(late.match.sets[0].homePoints, 2);
  assert.equal(await db.scoreAction.count({ where: { requestId: command.requestId } }), 1);
  await assert.rejects(performScoreAction(db, actors.main, "M01", { ...command, action: { type: "POINT", setIndex: 1, side: "away", delta: 1 } }), isError("REQUEST_ID_REUSED"));
  await assert.rejects(performScoreAction(db, actors.admin, "M01", command), isError("REQUEST_ID_REUSED"));
});

test("重复整场提交：相同请求幂等；不同请求锁定拒绝；成绩版本仅增加一次", async (t) => {
  const { db, actors, send } = await fixture(t); await send({ type: "START" }); await send({ type: "SET_SCORE", setIndex: 1, homePoints: 1, awayPoints: 0 });
  const command: ScoreCommand = { requestId: randomUUID(), expectedVersion: 2, action: { type: "SUBMIT_MATCH" } };
  await performScoreAction(db, actors.main, "M01", command);
  const replay = await performScoreAction(db, actors.main, "M01", command); assert.equal(replay.receipt.replayed, true);
  assert.equal((await db.tournament.findUniqueOrThrow({ where: { id: "current" } })).groupResultsRevision, 1);
  await assert.rejects(performScoreAction(db, actors.main, "M01", { ...command, requestId: randomUUID(), expectedVersion: 3 }), isError("MATCH_LOCKED"));
  assert.equal(await db.scoreAction.count({ where: { operation: "SUBMIT_MATCH" } }), 1);
});

test("两个数据库连接同版本并发记分：一方成功另一方冲突，过期请求不覆盖新成绩", async (t) => {
  const { db, url, actors, send } = await fixture(t); await send({ type: "START" });
  const other = createFourVFourClient(url); t.after(async () => { await other.$disconnect(); });
  const action: ScoreAction = { type: "POINT", setIndex: 1, side: "home", delta: 1 };
  const results = await Promise.allSettled([db, other].map((client) => performScoreAction(client, actors.main, "M01", { requestId: randomUUID(), expectedVersion: 1, action })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(isError("VERSION_CONFLICT")(rejected.reason), JSON.stringify({ code: rejected.reason?.code, meta: rejected.reason?.meta }));
  assert.equal((await readStaffMatch(db, actors.main, "M01")).sets[0].homePoints, 1);
});

test("两个连接并发重试相同请求：一条加分记录，双方收到同一应用版本", async (t) => {
  const { db, url, actors, send } = await fixture(t); await send({ type: "START" });
  const other = createFourVFourClient(url); t.after(async () => { await other.$disconnect(); });
  const command: ScoreCommand = { requestId: randomUUID(), expectedVersion: 1, action: { type: "POINT", setIndex: 1, side: "home", delta: 1 } };
  const results = await Promise.all([db, other].map((client) => performScoreAction(client, actors.main, "M01", command)));
  assert.ok(results.every((result) => result.receipt.appliedVersion === 2));
  assert.equal(await db.scoreAction.count({ where: { requestId: command.requestId } }), 1);
  assert.equal((await readStaffMatch(db, actors.main, "M01")).sets[0].homePoints, 1);
});

test("两场地可以独立开始和记分，包含相同队伍也不新增跨场地冲突检测", async (t) => {
  const { db, actors, send } = await fixture(t); await send({ type: "START" });
  await performScoreAction(db, actors.secondary, "M06", { requestId: randomUUID(), expectedVersion: 0, action: { type: "START" } }); // A1 is also on the main court.
  await performScoreAction(db, actors.secondary, "M06", { requestId: randomUUID(), expectedVersion: 1, action: { type: "POINT", setIndex: 1, side: "away", delta: 1 } });
  assert.equal((await readStaffMatch(db, actors.secondary, "M06")).sets[0].awayPoints, 1);
  assert.equal((await readStaffMatch(db, actors.main, "M01")).sets[0].homePoints, 0);
});

test("交叉确认失效公开边界：未曾确认/尚未开始隐藏；真实开始和结束保留原双方及比分并标待复核", async (t) => {
  const { db, send, actors } = await fixture(t, true);
  await performScoreAction(db, actors.main, "M15", { requestId: randomUUID(), expectedVersion: 0, action: { type: "START" } });
  for (let index = 1, version = 1; index <= 2; index++) {
    await performScoreAction(db, actors.main, "M15", { requestId: randomUUID(), expectedVersion: version++, action: { type: "SET_SCORE", setIndex: index, homePoints: 15, awayPoints: 12 } });
    await performScoreAction(db, actors.main, "M15", { requestId: randomUUID(), expectedVersion: version++, action: { type: "CONFIRM_SET", setIndex: index } });
  }
  await performScoreAction(db, actors.main, "M15", { requestId: randomUUID(), expectedVersion: 5, action: { type: "SUBMIT_MATCH" } });
  await send({ type: "START" }); await send({ type: "SET_SCORE", setIndex: 1, homePoints: 9, awayPoints: 7 });
  const original = await readPublicSchedule(db); if (original.publication !== "published") assert.fail();
  await db.approval.updateMany({ where: { type: "CROSS" }, data: { invalidatedAt: new Date() } });
  await db.tournament.update({ where: { id: "current" }, data: { groupResultsRevision: { increment: 1 } } });
  // A manually inconsistent LIVE status is not evidence of an authorized real start.
  await db.match.update({ where: { id: "M14" }, data: { status: "LIVE", startedAt: new Date() } });
  await db.setScore.create({ data: { matchId: "M14", setIndex: 1, homePoints: 99, awayPoints: 88 } });
  const hidden = await readPublicSchedule(db); if (hidden.publication !== "published") assert.fail();
  for (const code of ["M13", "M15"]) {
    const before: PublicMatch = original.matches.find((match) => match.code === code)!; const after: PublicMatch = hidden.matches.find((match) => match.code === code)!;
    assert.deepEqual(after.home, before.home); assert.deepEqual(after.away, before.away); assert.deepEqual(after.sets, before.sets);
    assert.equal(after.needsReview, true); assert.equal(after.status, before.status);
  }
  for (const code of ["M14", "M16", "M17", "M18"]) {
    const match: PublicMatch = hidden.matches.find((row) => row.code === code)!;
    assert.equal(match.home.team, null); assert.equal(match.away.team, null); assert.deepEqual(match.sets, []); assert.equal(match.status, "NOT_STARTED");
  }
  assert.equal(hidden.crossNeedsReview, true);
});

test("尚未确认的交叉赛不能开始；真正开赛后确认失效仍能完成原比赛", async (t) => {
  const { db, send, actors } = await fixture(t, true); await send({ type: "START" });
  await db.approval.updateMany({ where: { type: "CROSS" }, data: { invalidatedAt: new Date() } });
  await assert.rejects(performScoreAction(db, actors.main, "M14", { requestId: randomUUID(), expectedVersion: 0, action: { type: "START" } }), isError("UNRESOLVED_MATCH"));
  const result = await send({ type: "POINT", setIndex: 1, side: "home", delta: 1 }); assert.equal(result.match.needsReview, true);
});

test("从未确认过的交叉对阵，即使误填双方/比分/进行中状态也不公开", async (t) => {
  const { db } = await fixture(t);
  await db.match.update({ where: { id: "M13" }, data: { homeTeamId: "team:A1", awayTeamId: "team:B1", status: "LIVE", startedAt: new Date() } });
  await db.setScore.create({ data: { matchId: "M13", setIndex: 1, homePoints: 9, awayPoints: 7 } });
  assert.equal(await db.approval.count({ where: { type: "CROSS" } }), 0);
  const publicData = await readPublicSchedule(db); if (publicData.publication !== "published") assert.fail();
  const match = publicData.matches.find((row) => row.code === "M13")!;
  assert.equal(match.home.team, null); assert.equal(match.away.team, null); assert.equal(match.status, "NOT_STARTED");
  assert.deepEqual(match.sets, []); assert.equal(match.needsReview, false);
});

test("管理员修正BO3为2:0保留原第三局，再修正为1:1时必须补全正式胜者", async (t) => {
  const { db, send, actors } = await fixture(t, true); await send({ type: "START" });
  for (const [index, homePoints, awayPoints] of [[1, 15, 10], [2, 11, 15], [3, 15, 13]]) {
    await send({ type: "SET_SCORE", setIndex: index, homePoints, awayPoints }); await send({ type: "CONFIRM_SET", setIndex: index });
  }
  await send({ type: "SUBMIT_MATCH" });
  const corrected = await send({ type: "CORRECT_RESULT", sets: [{ setIndex: 1, homePoints: 15, awayPoints: 10 }, { setIndex: 2, homePoints: 15, awayPoints: 11 }] }, actors.admin);
  assert.equal(corrected.match.sets[2].excluded, true); assert.equal(corrected.match.sets[2].awayPoints, 13);
  const restored = await send({ type: "CORRECT_RESULT", sets: [{ setIndex: 1, homePoints: 15, awayPoints: 10 }, { setIndex: 2, homePoints: 11, awayPoints: 15 }] }, actors.admin);
  assert.equal(restored.match.sets[2].excluded, false); assert.equal(restored.match.winnerId, restored.match.homeTeamId);
  assert.equal(await db.scoreAction.count({ where: { operation: "CORRECT_RESULT" } }), 2);
});

for (const mode of [8, 10] as const) {
  test(`${mode}队同场地只允许一场进行中：记分员/管理员均被拦截，原场提交后才能开下一场`, async (t) => {
    const { db, actors } = await fixture(t, false, mode);
    const originalStart: ScoreCommand = { requestId: randomUUID(), expectedVersion: 0, action: { type: "START" } };
    await performScoreAction(db, actors.main, "M01", originalStart);
    assert.equal((await readStaffMatch(db, actors.main, "M03")).courtBusyMatchCode, "M01");
    for (const actor of [actors.main, actors.admin]) {
      const requestId = randomUUID();
      await assert.rejects(performScoreAction(db, actor, "M03", { requestId, expectedVersion: 0, action: { type: "START" } }), (error) => {
        assert.ok(error instanceof ScoringError); assert.equal(error.code, "COURT_BUSY"); assert.equal(error.status, 409);
        assert.match(error.message, /主场地已有 M01/); assert.equal(error.match?.courtBusyMatchCode, "M01"); return true;
      });
      assert.equal(await db.scoreAction.count({ where: { requestId } }), 0);
    }
    const untouched = await db.match.findUniqueOrThrow({ where: { id: "M03" }, include: { sets: true } });
    assert.equal(untouched.status, "NOT_STARTED"); assert.equal(untouched.version, 0); assert.equal(untouched.startedAt, null); assert.deepEqual(untouched.sets, []);
    await performScoreAction(db, actors.main, "M01", { requestId: randomUUID(), expectedVersion: 1, action: { type: "SET_SCORE", setIndex: 1, homePoints: 23, awayPoints: 19 } });
    await performScoreAction(db, actors.main, "M01", { requestId: randomUUID(), expectedVersion: 2, action: { type: "SUBMIT_MATCH" } });
    assert.equal((await readStaffMatch(db, actors.main, "M03")).courtBusyMatchCode, null);
    await performScoreAction(db, actors.main, "M03", { requestId: randomUUID(), expectedVersion: 0, action: { type: "START" } });
    const late = await performScoreAction(db, actors.main, "M01", originalStart);
    assert.equal(late.receipt.replayed, true); assert.equal(late.match.status, "FINISHED");
    assert.equal(await db.match.count({ where: { courtId: "main", status: "LIVE" } }), 1);
  });

  test(`${mode}队两个数据库连接并发开始同一场地的不同比赛：只成功一场`, async (t) => {
    const { db, url, actors } = await fixture(t, false, mode);
    const other = createFourVFourClient(url); t.after(async () => { await other.$disconnect(); });
    const results = await Promise.allSettled([{ client: db, code: "M01" }, { client: other, code: "M03" }].map(({ client, code }) => performScoreAction(client, actors.main, code, { requestId: randomUUID(), expectedVersion: 0, action: { type: "START" } })));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    assert.ok(isError("COURT_BUSY")(rejected.reason));
    assert.equal(await db.match.count({ where: { courtId: "main", status: "LIVE" } }), 1);
    assert.equal(await db.scoreAction.count({ where: { operation: "START" } }), 1);
  });
}

test("BO3结束局但尚未提交整场仍占用场地；旧双开记录不被自动删除且可以正常提交", async (t) => {
  const { db, send, actors } = await fixture(t, true); await send({ type: "START" });
  for (const setIndex of [1, 2]) { await send({ type: "SET_SCORE", setIndex, homePoints: 15, awayPoints: 12 }); await send({ type: "CONFIRM_SET", setIndex }); }
  await assert.rejects(performScoreAction(db, actors.main, "M14", { requestId: randomUUID(), expectedVersion: 0, action: { type: "START" } }), isError("COURT_BUSY"));
  // Simulate records created before this rule was introduced. They must remain intact.
  const approval = await db.approval.findFirstOrThrow({ where: { type: "CROSS", invalidatedAt: null } });
  await db.match.update({ where: { id: "M15" }, data: { status: "LIVE", startedAt: new Date(), crossApprovalIdAtStart: approval.id } });
  await db.setScore.createMany({ data: [1, 2].map((setIndex) => ({ matchId: "M15", setIndex, homePoints: 15, awayPoints: 12, confirmed: true })) });
  await send({ type: "SUBMIT_MATCH" });
  await performScoreAction(db, actors.main, "M15", { requestId: randomUUID(), expectedVersion: 0, action: { type: "SUBMIT_MATCH" } });
  assert.equal(await db.match.count({ where: { courtId: "main", status: "LIVE" } }), 0);
  assert.equal((await db.match.findUniqueOrThrow({ where: { id: "M13" } })).status, "FINISHED");
  assert.equal((await db.match.findUniqueOrThrow({ where: { id: "M15" } })).status, "FINISHED");
  assert.equal(await db.setScore.count({ where: { matchId: "M15" } }), 2);
});
