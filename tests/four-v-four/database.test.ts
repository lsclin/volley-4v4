import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@libsql/client";
import { createFourVFourClient } from "../../src/lib/four-v-four/database.ts";
import { resolveFourVFourDatabaseUrl } from "../../src/lib/four-v-four/database-url.ts";
import { migrateFourVFour } from "../../src/lib/four-v-four/migrate.ts";
import { initializeTournament, readAdminSetup, readPublicSchedule, publishSchedule, updateTeamNames, updateTournamentText } from "../../src/lib/four-v-four/repository.ts";

async function fixture(t: TestContext) {
  const root = process.env.FOUR_V_FOUR_TEST_ROOT;
  if (!root) throw new Error("请通过npm run test:4v4运行隔离数据库测试");
  const directory = await mkdtemp(path.join(root, "case-"));
  const url = `file:${path.join(directory, "four-v-four.db")}`;
  const legacyUrl = `file:${path.join(directory, "legacy.db")}`;
  const env = { FOUR_V_FOUR_DATABASE_URL: url, DATABASE_URL: legacyUrl };
  await migrateFourVFour(env);
  const db = createFourVFourClient(url);
  t.after(async () => {
    await db.$disconnect();
    // The parent runner removes only its verified sandbox after this process exits.
    // Windows SQLite native handles can outlive disconnected prepared statements.
  });
  return { db, env, url, legacyUrl };
}

for (const mode of [8, 10] as const) {
  test(`${mode}队：实际迁移、初始化持久化与重启读取`, async (t) => {
    const { db, url } = await fixture(t);
    await initializeTournament(db, { mode });
    const setup = await readAdminSetup(db);
    assert.equal(setup!.mode, mode);
    assert.equal(setup!.teams.length, mode);
    assert.equal(setup!.matches.length, mode === 8 ? 18 : 27);
    assert.deepEqual(setup!.courts.map((c) => c.netHeightCm).sort(), [224, 243]);
    assert.ok(setup!.teams.every((team) => team.name === ""));
    assert.ok(setup!.matches.every((m) => m.status === "NOT_STARTED" && m.version === 0));
    assert.ok(setup!.matches.filter((m) => m.stage !== "GROUP").every((m) => m.homeTeamId === null && m.awayTeamId === null));
    await db.$disconnect();
    const second = createFourVFourClient(url);
    assert.equal((await second.match.count()), mode === 8 ? 18 : 27);
    await second.$disconnect();
  });
  test(`${mode}队：登记队名与赛程发布，交叉对阵保持占位`, async (t) => {
    const { db } = await fixture(t); await initializeTournament(db, { mode });
    assert.equal((await readPublicSchedule(db)).publication, "draft");
    assert.deepEqual((await readPublicSchedule(db)).matches, []);
    await assert.rejects(publishSchedule(db, 0), /队名登记/);
    const setup = (await readAdminSetup(db))!;
    const names = Object.fromEntries(setup.teams.map((team) => [team.drawCode, `测试队伍-${team.drawCode}`]));
    const revision = await updateTeamNames(db, names, 0);
    await publishSchedule(db, revision);
    const publicData = await readPublicSchedule(db);
    assert.equal(publicData.publication, "published");
    assert.equal(publicData.teams.length, mode);
    if (publicData.publication === "published") {
      assert.equal(publicData.crossPublished, false); assert.equal(publicData.finalPublished, false);
      assert.ok(publicData.matches.filter((m) => m.stage === "GROUP").every((m) => !!m.home.team && !!m.away.team));
      assert.ok(publicData.matches.filter((m) => m.stage !== "GROUP").every((m) => m.home.team === null && m.away.team === null));
      assert.ok(!("revision" in publicData)); assert.ok(!("approvals" in publicData)); assert.ok(!("credentials" in publicData));
    }
  });
}

test("旧站数据库内容和文件不因4v4迁移改变；迁移重复执行不丢数据", async (t) => {
  const { db, env, legacyUrl } = await fixture(t);
  const legacy = createClient({ url: legacyUrl });
  await legacy.executeMultiple("CREATE TABLE Competition(id TEXT PRIMARY KEY, name TEXT); INSERT INTO Competition VALUES ('legacy','旧站赛事保留');");
  legacy.close();
  const before = createHash("sha256").update(await readFile(legacyUrl.slice(5))).digest("hex");
  await initializeTournament(db, { mode: 8 });
  assert.deepEqual(await migrateFourVFour(env), []);
  assert.equal(await db.match.count(), 18);
  assert.equal(createHash("sha256").update(await readFile(legacyUrl.slice(5))).digest("hex"), before);
});

test("拒绝向含旧模块数据表的数据库运行4v4迁移", async (t) => {
  const { legacyUrl } = await fixture(t);
  const legacy = createClient({ url: legacyUrl });
  await legacy.execute("CREATE TABLE Competition(id TEXT PRIMARY KEY)"); legacy.close();
  await assert.rejects(migrateFourVFour({ FOUR_V_FOUR_DATABASE_URL: legacyUrl }), /非4v4/);
  const verify = createClient({ url: legacyUrl });
  const tables = await verify.execute("SELECT name FROM sqlite_master WHERE type='table'");
  assert.deepEqual(tables.rows.map((r) => r.name), ["Competition"]); verify.close();
});

test("初始化不能覆盖赛事；非法模式不产生部分数据", async (t) => {
  const { db } = await fixture(t);
  await assert.rejects(initializeTournament(db, { mode: 9 })); assert.equal(await db.tournament.count(), 0);
  await initializeTournament(db, { mode: 8 });
  await assert.rejects(initializeTournament(db, { mode: 10 }), /不能覆盖/);
  assert.equal(await db.team.count(), 8); assert.equal(await db.match.count(), 18);
});

test("错误队名编号与过期版本均回滚，不覆盖更新结果", async (t) => {
  const { db } = await fixture(t); await initializeTournament(db, { mode: 8 });
  await assert.rejects(updateTeamNames(db, { A1: "甲", A5: "非法队" }, 0));
  assert.equal((await db.team.findUniqueOrThrow({ where: { id: "team:A1" } })).name, "");
  await updateTeamNames(db, { A1: "新名称" }, 0);
  await assert.rejects(updateTeamNames(db, { A1: "过期覆盖" }, 0), /版本已变化/);
  assert.equal((await db.team.findUniqueOrThrow({ where: { id: "team:A1" } })).name, "新名称");
  assert.equal(await db.auditLog.count({ where: { operation: "TEAM_NAMES" } }), 1);
});

test("赛后仅修正队名，不更改抽签编号或分组；配置文字修改有日志", async (t) => {
  const { db } = await fixture(t); await initializeTournament(db, { mode: 8 });
  await db.tournament.update({ where: { id: "current" }, data: { startedAt: new Date() } });
  await updateTeamNames(db, { A1: "修正名称" }, 0);
  await updateTournamentText(db, { name: "赛事正式名称", rulesText: "赛前确认规则" }, 1);
  const team = await db.team.findUniqueOrThrow({ where: { id: "team:A1" } });
  assert.equal(team.drawCode, "A1"); assert.equal(team.group, "A");
  assert.equal(await db.auditLog.count(), 3);
  await assert.rejects(updateTournamentText(db, { name: "过期内容" }, 1));
});

test("公开投影不泄露未确认交叉赛的实际队名或最终名次草稿", async (t) => {
  const { db } = await fixture(t); await initializeTournament(db, { mode: 8 });
  const setup = (await readAdminSetup(db))!;
  await updateTeamNames(db, Object.fromEntries(setup.teams.map((x) => [x.drawCode, x.drawCode])), 0);
  await publishSchedule(db, 1);
  await db.match.update({ where: { id: "M13" }, data: { homeTeamId: "team:A1", awayTeamId: "team:B2" } });
  const data = await readPublicSchedule(db);
  if (data.publication !== "published") assert.fail();
  assert.equal(data.matches.find((m) => m.code === "M13")!.home.team, null);
  assert.ok(!JSON.stringify(data).includes("snapshot"));
});

test("比分非负与局序约束，允许非标准终局分数；排除局原始分数可保留", async (t) => {
  const { db } = await fixture(t); await initializeTournament(db, { mode: 8 });
  await assert.rejects(db.setScore.create({ data: { matchId: "M01", setIndex: 1, homePoints: -1 } }));
  await assert.rejects(db.setScore.create({ data: { matchId: "M01", setIndex: 4 } }));
  await db.setScore.create({ data: { matchId: "M01", setIndex: 1, homePoints: 23, awayPoints: 19, confirmed: true } });
  await db.setScore.create({ data: { matchId: "M13", setIndex: 3, homePoints: 18, awayPoints: 16, confirmed: true, excluded: true, exclusionReason: "前两局修正后形成2:0" } });
  const row = await db.setScore.findUniqueOrThrow({ where: { matchId_setIndex: { matchId: "M13", setIndex: 3 } } });
  assert.equal(row.homePoints, 18); assert.equal(row.excluded, true);
});

test("记分请求编号唯一；场地引用、场地访问码与版本字段有约束", async (t) => {
  const { db } = await fixture(t); await initializeTournament(db, { mode: 8 });
  const action = { requestId: "retry-id", matchId: "M01", actor: "test", operation: "INCREMENT", payload: "{}", before: "{}", after: "{}", expectedVersion: 0, resultingVersion: 1 };
  await db.scoreAction.create({ data: action }); await assert.rejects(db.scoreAction.create({ data: action }));
  await assert.rejects(db.scoreAction.create({ data: { ...action, requestId: "bad-version", resultingVersion: 4 } }));
  await assert.rejects(db.credential.create({ data: { role: "SCORER", codeHash: "test-hash" } }));
  await assert.rejects(db.credential.create({ data: { role: "ADMIN", courtId: "main", codeHash: "test-hash" } }));
  await assert.rejects(db.match.update({ where: { id: "M01" }, data: { courtId: "missing-court" } }));
});

test("单赛事、固定模式、规则、三种状态及每片场地队列编号约束", async (t) => {
  const { db } = await fixture(t); await initializeTournament(db, { mode: 8 });
  await assert.rejects(db.tournament.create({ data: { id: "second", mode: 8, name: "第二赛事" } }));
  await assert.rejects(db.tournament.update({ where: { id: "current" }, data: { mode: 12 } }));
  await assert.rejects(db.tournament.update({ where: { id: "current" }, data: { groupTarget: 15 } }));
  await assert.rejects(db.match.update({ where: { id: "M01" }, data: { sequence: 2 } }));
  await assert.rejects(db.$executeRawUnsafe("UPDATE Match SET status = 'PAUSED' WHERE id = 'M01'"));
});

test("同种发布确认仅有一个生效快照，失效历史可以保留", async (t) => {
  const { db } = await fixture(t); await initializeTournament(db, { mode: 8 });
  const first = await db.approval.create({ data: { type: "CROSS", sourceRevision: 1, snapshot: "{}", approvedBy: "test" } });
  await assert.rejects(db.approval.create({ data: { type: "CROSS", sourceRevision: 2, snapshot: "{}", approvedBy: "test" } }));
  await db.approval.update({ where: { id: first.id }, data: { invalidatedAt: new Date() } });
  await db.approval.create({ data: { type: "CROSS", sourceRevision: 2, snapshot: "{}", approvedBy: "test" } });
  assert.equal(await db.approval.count(), 2);
});

test("比赛开始后模式与抽签关系锁定，队名仍可修正", async (t) => {
  const { db } = await fixture(t); await initializeTournament(db, { mode: 8 });
  await db.match.update({ where: { id: "M01" }, data: { status: "LIVE" } });
  await assert.rejects(db.tournament.update({ where: { id: "current" }, data: { mode: 10 } }));
  await assert.rejects(db.team.update({ where: { id: "team:A1" }, data: { drawCode: "A5", slot: 5 } }));
  await updateTeamNames(db, { A1: "可修正拼写" }, 0);
  assert.equal((await db.team.findUniqueOrThrow({ where: { id: "team:A1" } })).name, "可修正拼写");
});

test("小组成绩版本变化使未重新确认的交叉对阵恢复占位", async (t) => {
  const { db } = await fixture(t); await initializeTournament(db, { mode: 8 });
  const setup = (await readAdminSetup(db))!;
  await updateTeamNames(db, Object.fromEntries(setup.teams.map((x) => [x.drawCode, x.drawCode])), 0);
  await publishSchedule(db, 1);
  await db.match.update({ where: { id: "M13" }, data: { homeTeamId: "team:A1", awayTeamId: "team:B2" } });
  await db.approval.create({ data: { type: "CROSS", sourceRevision: 0, snapshot: "{}", approvedBy: "test" } });
  const first = await readPublicSchedule(db); assert.equal(first.publication, "published");
  if (first.publication !== "published") assert.fail(); assert.equal(first.crossPublished, true);
  await db.tournament.update({ where: { id: "current" }, data: { groupResultsRevision: 1 } });
  const stale = await readPublicSchedule(db); if (stale.publication !== "published") assert.fail();
  assert.equal(stale.crossPublished, false);
  assert.equal(stale.matches.find((m) => m.code === "M13")!.home.team, null);
  assert.equal((await db.match.findUniqueOrThrow({ where: { id: "M13" } })).homeTeamId, "team:A1");
  const originalApproval = await db.approval.findFirstOrThrow({ where: { type: "CROSS" } });
  await db.match.update({ where: { id: "M13" }, data: { status: "LIVE", startedAt: new Date(), crossApprovalIdAtStart: originalApproval.id } });
  const started = await readPublicSchedule(db); if (started.publication !== "published") assert.fail();
  assert.equal(started.crossNeedsReview, true);
  assert.equal(started.matches.find((m) => m.code === "M13")!.home.team!.drawCode, "A1");
});

test("数据库URL防护：相同文件、旧站文件别名及同一云库均拒绝", () => {
  assert.throws(() => resolveFourVFourDatabaseUrl({ FOUR_V_FOUR_DATABASE_URL: "file:./data/../dev.db" }));
  assert.throws(() => resolveFourVFourDatabaseUrl({ FOUR_V_FOUR_DATABASE_URL: "file:./separate.db", DATABASE_URL: "file:./x/../separate.db" }));
  assert.throws(() => resolveFourVFourDatabaseUrl({ FOUR_V_FOUR_DATABASE_URL: "libsql://EXAMPLE.turso.io/", DATABASE_URL: "libsql://example.turso.io" }));
  assert.throws(() => resolveFourVFourDatabaseUrl({ NODE_ENV: "production" }));
  assert.throws(() => resolveFourVFourDatabaseUrl({ FOUR_V_FOUR_DATABASE_URL: "file::memory:" }));
  assert.match(resolveFourVFourDatabaseUrl({}), /four-v-four\.db$/);
});
