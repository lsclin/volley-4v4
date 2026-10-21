import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createFourVFourClient } from "../../src/lib/four-v-four/database.ts";
import { migrateFourVFour } from "../../src/lib/four-v-four/migrate.ts";
import { authenticateAccessCode, setAccessCode } from "../../src/lib/four-v-four/credentials.ts";
import { performAdminAction, readAdminTournament } from "../../src/lib/four-v-four/admin-service.ts";
import type { AdminCommand } from "../../src/lib/four-v-four/admin-service.ts";
import { previewCross } from "../../src/lib/four-v-four/admin-logic.ts";
import { performScoreAction, readStaffMatch } from "../../src/lib/four-v-four/scoring-service.ts";
import { initializeTournament, readPublicSchedule } from "../../src/lib/four-v-four/repository.ts";
import { ScoringError } from "../../src/lib/four-v-four/scoring-types.ts";
import type { Principal, ScoreAction } from "../../src/lib/four-v-four/scoring-types.ts";

const fails = (code: string) => (error: unknown) => error instanceof ScoringError && error.code === code;
async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(process.env.FOUR_V_FOUR_TEST_ROOT!, "admin-"));
  const url = `file:${path.join(directory, "event.db")}`;
  await migrateFourVFour({ FOUR_V_FOUR_DATABASE_URL: url });
  const db = createFourVFourClient(url); t.after(async () => { await db.$disconnect(); });
  const credential = await setAccessCode(db, "admin", "review-admin-before-setup");
  const admin: Principal = { id: credential.id, version: credential.version, role: credential.role, courtId: credential.courtId };
  const manage = async (action: AdminCommand["action"], principal = admin) => {
    const state = await readAdminTournament(db, admin);
    return performAdminAction(db, principal, { expectedRevision: state.tournament?.revision ?? null, action });
  };
  const score = async (code: string, action: ScoreAction, principal = admin) => {
    const match = await readStaffMatch(db, principal, code);
    return performScoreAction(db, principal, code, { requestId: randomUUID(), expectedVersion: match.version, action });
  };
  const finish = async (code: string, homeWins = true) => {
    const match = await readStaffMatch(db, admin, code);
    await score(code, { type: "START" });
    for (let setIndex = 1; setIndex <= (match.format === "BO1" ? 1 : 2); setIndex++) {
      await score(code, { type: "SET_SCORE", setIndex, homePoints: homeWins ? 25 : 17, awayPoints: homeWins ? 17 : 25 });
      if (match.format === "BO3") await score(code, { type: "CONFIRM_SET", setIndex });
    }
    await score(code, { type: "SUBMIT_MATCH" });
  };
  const setup = async (mode: 8 | 10) => {
    await manage({ type: "INITIALIZE", mode, name: "阶段四隔离测试赛事" });
    const state = await readAdminTournament(db, admin);
    await manage({ type: "TEAMS", names: Object.fromEntries(state.teams.map((team) => [team.drawCode, `测试队-${team.drawCode}`])) });
    await manage({ type: "PUBLISH_SCHEDULE" });
  };
  const groups = async () => {
    const state = await readAdminTournament(db, admin);
    for (const match of state.matches.filter((row) => row.stage === "GROUP")) await finish(match.code, match.home.team!.drawCode < match.away.team!.drawCode);
  };
  const cross = async (acknowledgePlayed = false) => {
    const state = await readAdminTournament(db, admin);
    return manage({ type: "CONFIRM_CROSS", sourceRevision: state.tournament!.groupResultsRevision, tieBreaks: {}, reason: "", acknowledgePlayed });
  };
  const final = async (acknowledgePlayed = false) => {
    const state = await readAdminTournament(db, admin);
    return manage({ type: "CONFIRM_FINAL", sourceRevision: state.tournament!.resultsRevision, acknowledgePlayed });
  };
  return { db, url, directory, admin, manage, score, finish, setup, groups, cross, final };
}

for (const mode of [8, 10] as const) {
  test(`${mode}队完整管理闭环：空库登录、初始化、抽签登记、发布、逐场记分、交叉确认、最终公布及重新确认`, async (t) => {
    const f = await fixture(t); const { db, admin } = f;
    assert.equal((await readAdminTournament(db, admin)).tournament, null);
    assert.equal((await authenticateAccessCode(db, "review-admin-before-setup"))?.role, "ADMIN");
    await assert.rejects(setAccessCode(db, "main", "before-setup-code"), fails("NOT_CONFIGURED"));
    await f.manage({ type: "INITIALIZE", mode, name: "完整赛事" });
    assert.equal((await db.credential.findUniqueOrThrow({ where: { id: admin.id } })).tournamentId, "current");
    assert.equal(await db.match.count(), mode === 8 ? 18 : 27);
    await assert.rejects(f.manage({ type: "INITIALIZE", mode: mode === 8 ? 10 : 8, name: "不得覆盖" }), fails("ALREADY_CONFIGURED"));
    await assert.rejects(f.manage({ type: "PUBLISH_SCHEDULE" }), fails("INCOMPLETE_TEAMS"));
    const initial = await readAdminTournament(db, admin);
    await f.manage({ type: "TEAMS", names: Object.fromEntries(initial.teams.map((team) => [team.drawCode, `队伍${team.drawCode}`])) });
    assert.equal((await readPublicSchedule(db)).matches.length, 0);
    await f.manage({ type: "PUBLISH_SCHEDULE" });
    await assert.rejects(f.cross(), fails("GROUPS_INCOMPLETE"));
    await assert.rejects(f.final(), fails("RESULTS_INCOMPLETE"));
    await f.groups();
    let publicData = await readPublicSchedule(db); if (publicData.publication !== "published") assert.fail();
    assert.equal(publicData.crossPublished, false);
    assert.ok(publicData.matches.filter((match) => match.stage !== "GROUP").every((match) => !match.home.team && !match.away.team));
    await f.cross(); await assert.rejects(f.cross(), fails("ALREADY_PUBLISHED"));
    const preview = await readAdminTournament(db, admin);
    const semi = preview.matches.filter((match) => match.stage === "SEMIFINAL").sort((a, b) => a.code.localeCompare(b.code));
    assert.equal(semi[0].home.team!.drawCode, "A1"); assert.equal(semi[0].away.team!.drawCode, "B2");
    assert.equal(semi[1].home.team!.drawCode, "B1"); assert.equal(semi[1].away.team!.drawCode, "A2");
    for (const stage of ["PLACEMENT", "SEMIFINAL", "THIRD_PLACE", "FINAL"]) for (const match of preview.matches.filter((row) => row.stage === stage)) await f.finish(match.code);
    const finals = await readAdminTournament(db, admin); assert.equal(finals.final.rankings.length, mode);
    publicData = await readPublicSchedule(db); if (publicData.publication !== "published") assert.fail();
    assert.deepEqual(publicData.finalStandings, []); assert.equal(publicData.finalPublished, false);
    await f.final(); await assert.rejects(f.final(), fails("ALREADY_PUBLISHED"));
    publicData = await readPublicSchedule(db); if (publicData.publication !== "published") assert.fail();
    assert.equal(publicData.finalStandings.length, mode); assert.equal(publicData.finalPublished, true);
    const finalMatch = finals.matches.find((match) => match.stage === "FINAL")!;
    await f.score(finalMatch.code, { type: "CORRECT_RESULT", sets: [{ setIndex: 1, homePoints: 11, awayPoints: 15 }, { setIndex: 2, homePoints: 12, awayPoints: 15 }] });
    publicData = await readPublicSchedule(db); if (publicData.publication !== "published") assert.fail();
    assert.equal(publicData.finalPublished, false); assert.deepEqual(publicData.finalStandings, []);
    await f.final();
    assert.equal((await readAdminTournament(db, admin)).final.rankings[0].drawCode, finalMatch.away.team!.drawCode);
    await f.score("M01", { type: "CORRECT_RESULT", sets: [{ setIndex: 1, homePoints: 26, awayPoints: 17 }] });
    assert.equal((await readAdminTournament(db, admin)).cross.valid, false);
    assert.equal((await readAdminTournament(db, admin)).final.valid, false);
    const originalPlayed = await db.match.findMany({ where: { stage: { not: "GROUP" } }, include: { sets: true } });
    await f.cross(); await f.final();
    assert.deepEqual(await db.match.findMany({ where: { stage: { not: "GROUP" } }, include: { sets: true } }), originalPlayed);
    assert.equal(await db.approval.count({ where: { type: "CROSS" } }), 2);
    assert.equal(await db.approval.count({ where: { type: "FINAL" } }), 3);
    assert.ok(await db.auditLog.count({ where: { operation: "CONFIRM_FINAL" } }) >= 3);
  });
}

test("场地/顺序调整保护实际比赛、乐观版本及固定比赛数，禁止越权/扩展字段", async (t) => {
  const f = await fixture(t); await f.setup(8); const { db, admin } = f;
  const scorer = await setAccessCode(db, "main", "review-main-code");
  const principal: Principal = { id: scorer.id, version: scorer.version, role: scorer.role, courtId: scorer.courtId };
  await assert.rejects(readAdminTournament(db, principal), fails("FORBIDDEN"));
  await assert.rejects(f.manage({ type: "CONFIG", name: "假管理", rulesText: "", location: "", noticeText: "" }, principal), fails("FORBIDDEN"));
  await assert.rejects(f.manage({ type: "TEAMS", names: { A5: "不存在的编号" } }), fails("INVALID_TEAM"));
  await assert.rejects(performAdminAction(db, admin, { expectedRevision: 2, action: { type: "CONFIG", mode: 10, name: "注入", rulesText: "", location: "", noticeText: "" } }), fails("INVALID_REQUEST"));
  await f.score("M01", { type: "START" });
  const locked = await db.match.findUniqueOrThrow({ where: { id: "M01" } });
  await assert.rejects(f.manage({ type: "MOVE_MATCH", code: "M01", expectedVersion: locked.version, courtId: "secondary", sequence: 1 }), fails("MATCH_LOCKED"));
  await assert.rejects(f.manage({ type: "MOVE_MATCH", code: "M03", expectedVersion: 0, courtId: "main", sequence: 1 }), fails("SLOT_LOCKED"));
  await f.manage({ type: "MOVE_MATCH", code: "M02", expectedVersion: 0, courtId: "main", sequence: 2 });
  assert.deepEqual(await db.match.findUniqueOrThrow({ where: { id: "M01" } }), locked);
  assert.equal((await db.match.findUniqueOrThrow({ where: { id: "M02" } })).courtId, "main");
  assert.equal(await db.match.count(), 18);
  await assert.rejects(f.manage({ type: "MOVE_MATCH", code: "M02", expectedVersion: 0, courtId: "secondary", sequence: 1 }), fails("VERSION_CONFLICT"));
  await assert.rejects(f.score("M02", { type: "START" }), fails("COURT_BUSY"));
  await f.manage({ type: "TEAMS", names: { A1: "开赛后修正队名" } });
  await assert.rejects(db.tournament.update({ where: { id: "current" }, data: { mode: 10 } }));
  await assert.rejects(db.team.update({ where: { id: "team:A1" }, data: { group: "B" } }));
  const stale = (await readAdminTournament(db, admin)).tournament!.revision;
  await f.manage({ type: "CONFIG", name: "修正信息", location: "球场", rulesText: "第一段\n\n第二段", noticeText: "现场公告" });
  await assert.rejects(performAdminAction(db, admin, { expectedRevision: stale, action: { type: "TEAMS", names: { A1: "不得覆盖" } } }), fails("VERSION_CONFLICT"));
  const data = await readPublicSchedule(db); if (data.publication !== "published") assert.fail(); assert.equal(data.noticeText, "现场公告"); assert.equal(data.location, "球场");
});

test("成绩修正使交叉确认失效：隐藏未开打，保留已开打并明确复核后重新确认", async (t) => {
  const f = await fixture(t); await f.setup(8); await f.groups(); await f.cross();
  const before = await readAdminTournament(f.db, f.admin); const semi = before.matches.find((match) => match.stage === "SEMIFINAL")!;
  await f.score(semi.code, { type: "START" }); await f.score(semi.code, { type: "POINT", setIndex: 1, side: "home", delta: 1 });
  const actual = await f.db.match.findUniqueOrThrow({ where: { id: semi.code }, include: { sets: true } });
  await f.score("M01", { type: "CORRECT_RESULT", sets: [{ setIndex: 1, homePoints: 17, awayPoints: 25 }] });
  let data = await readPublicSchedule(f.db); if (data.publication !== "published") assert.fail();
  assert.equal(data.crossPublished, false); assert.equal(data.matches.find((row) => row.code === semi.code)!.needsReview, true);
  assert.equal(data.matches.find((row) => row.code === semi.code)!.home.team!.drawCode, actual.homeTeamId!.slice(5));
  assert.ok(data.matches.filter((row) => row.stage !== "GROUP" && row.status === "NOT_STARTED").every((row) => !row.home.team));
  await assert.rejects(f.cross(), fails("REVIEW_REQUIRED")); await f.cross(true);
  assert.deepEqual(await f.db.match.findUniqueOrThrow({ where: { id: semi.code }, include: { sets: true } }), actual);
  data = await readPublicSchedule(f.db); if (data.publication !== "published") assert.fail(); assert.equal(data.crossPublished, true);
});

test("完全并列裁定仅排列并列队伍，必须给出依据并记录确认快照", async (t) => {
  const f = await fixture(t); await f.setup(8);
  // Each group: slots 1,2,3 form an equal 25:20 cycle; all beat slot4 by 25:20.
  const state = await readAdminTournament(f.db, f.admin);
  for (const match of state.matches.filter((row) => row.stage === "GROUP")) {
    const a = Number(match.home.team!.drawCode.slice(1)), b = Number(match.away.team!.drawCode.slice(1));
    const homeWins = b === 4 || a !== 4 && (a === 1 && b === 2 || a === 2 && b === 3 || a === 3 && b === 1);
    await f.score(match.code, { type: "START" });
    await f.score(match.code, { type: "SET_SCORE", setIndex: 1, homePoints: homeWins ? 25 : 20, awayPoints: homeWins ? 20 : 25 });
    await f.score(match.code, { type: "SUBMIT_MATCH" });
  }
  const tied = await readAdminTournament(f.db, f.admin); assert.ok(tied.groups.every((group) => group.unresolved));
  await assert.rejects(f.cross(), fails("TIE_BREAK_REQUIRED"));
  assert.throws(() => previewCross(tied.groups, tied.matches, { "A:1": ["A1", "A2", "A4"] }), fails("INVALID_TIE_BREAK"));
  assert.throws(() => previewCross(tied.groups, tied.matches, { "A:4": ["A4"] }), fails("INVALID_TIE_BREAK"));
  const tieBreaks = { "A:1": ["A3", "A2", "A1"], "B:1": ["B2", "B1", "B3"] };
  await assert.rejects(f.manage({ type: "CONFIRM_CROSS", sourceRevision: tied.tournament!.groupResultsRevision, tieBreaks, reason: "", acknowledgePlayed: false }), fails("TIE_BREAK_REQUIRED"));
  await f.manage({ type: "CONFIRM_CROSS", sourceRevision: tied.tournament!.groupResultsRevision, tieBreaks, reason: "按赛前约定现场抽签裁定", acknowledgePlayed: false });
  const semifinal = (await readAdminTournament(f.db, f.admin)).matches.find((row) => row.stage === "SEMIFINAL")!;
  assert.equal(semifinal.home.team!.drawCode, "A3"); assert.equal(semifinal.away.team!.drawCode, "B1");
  const approval = await f.db.approval.findFirstOrThrow(); assert.deepEqual(JSON.parse(approval.snapshot).tieBreaks, tieBreaks);
  const published = await readPublicSchedule(f.db); if (published.publication !== "published") assert.fail();
  assert.deepEqual(published.groups[0].rows.map((row) => row.drawCode), ["A3", "A2", "A1", "A4"]);
  assert.equal(published.groups[0].unresolved, false);
});

for (const mode of [8, 10] as const) test(`${mode}队记分员密码：管理员指定密码、旧会话撤销、版本冲突、管理员凭据与赛事数据保留`, async (t) => {
  const f = await fixture(t); await f.setup(mode);
  const adminBefore = await f.db.credential.findUniqueOrThrow({ where: { id: f.admin.id } });
  const matchesBefore = await f.db.match.findMany({ include: { sets: true } });
  for (const target of ["main", "secondary"] as const) {
    const oldCode = `original-${target}-code`; const password = `specified-${target}-password`;
    const old = await setAccessCode(f.db, target, oldCode);
    const oldPrincipal: Principal = { id: old.id, role: old.role, courtId: old.courtId, version: old.version };
    const response = await f.manage({ type: "SET_SCORER_PASSWORD", target, password, expectedCredentialVersion: old.version });
    assert.equal("accessCode" in response, false); assert.equal(await authenticateAccessCode(f.db, oldCode), null);
    assert.equal((await authenticateAccessCode(f.db, password))?.courtId, target);
    await assert.rejects(readStaffMatch(f.db, oldPrincipal, "M01"), fails("SESSION_EXPIRED"));
    await assert.rejects(f.manage({ type: "SET_SCORER_PASSWORD", target, password: "another-new-password", expectedCredentialVersion: old.version }), fails("VERSION_CONFLICT"));
    const serialized = JSON.stringify({ credentials: await f.db.credential.findMany(), logs: await f.db.auditLog.findMany(), response });
    assert.ok(!serialized.includes(password));
  }
  assert.deepEqual(await f.db.credential.findUniqueOrThrow({ where: { id: f.admin.id } }), adminBefore);
  assert.deepEqual(await f.db.match.findMany({ include: { sets: true } }), matchesBefore);
  assert.equal((await authenticateAccessCode(f.db, "review-admin-before-setup"))?.role, "ADMIN");
  assert.ok(await readAdminTournament(f.db, f.admin));
});

test("记分员密码权限：拒绝记分员操作、管理员密码修改、旧重置命令及重复身份密码", async (t) => {
  const f = await fixture(t); await f.setup(8);
  const main = await setAccessCode(f.db, "main", "original-main-code");
  await setAccessCode(f.db, "secondary", "original-secondary-code");
  const principal: Principal = { id: main.id, role: main.role, courtId: main.courtId, version: main.version };
  const action = { type: "SET_SCORER_PASSWORD" as const, target: "main" as const, password: "new-main-password", expectedCredentialVersion: main.version };
  await assert.rejects(f.manage(action, principal), fails("FORBIDDEN"));
  const revision = (await readAdminTournament(f.db, f.admin)).tournament!.revision;
  for (const forbidden of [{ ...action, target: "admin" }, { type: "RESET_CODE", target: "admin", expectedCredentialVersion: f.admin.version }]) {
    await assert.rejects(performAdminAction(f.db, f.admin, { expectedRevision: revision, action: forbidden }), fails("INVALID_REQUEST"));
  }
  for (const password of ["review-admin-before-setup", "original-secondary-code"]) await assert.rejects(f.manage({ ...action, password }), fails("DUPLICATE_CODE"));
  await assert.rejects(f.manage({ ...action, password: "ab" }), fails("INVALID_REQUEST"));
  assert.equal((await authenticateAccessCode(f.db, "original-main-code"))?.version, main.version);
  assert.equal((await readAdminTournament(f.db, f.admin)).tournament!.revision, revision);
});

test("两个管理连接同时确认交叉赛只产生一份有效快照，过期成绩版本不能发布", async (t) => {
  const f = await fixture(t); await f.setup(8); await f.groups();
  const state = await readAdminTournament(f.db, f.admin);
  const input: AdminCommand = { expectedRevision: state.tournament!.revision, action: { type: "CONFIRM_CROSS", sourceRevision: state.tournament!.groupResultsRevision, tieBreaks: {}, reason: "", acknowledgePlayed: false } };
  const other = createFourVFourClient(f.url); t.after(async () => { await other.$disconnect(); });
  const outcomes = await Promise.allSettled([performAdminAction(f.db, f.admin, input), performAdminAction(other, f.admin, input)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected?.status === "rejected" && rejected.reason instanceof ScoringError && rejected.reason.code === "VERSION_CONFLICT");
  assert.equal(await f.db.approval.count({ where: { type: "CROSS", invalidatedAt: null } }), 1);
  await f.score("M01", { type: "CORRECT_RESULT", sets: [{ setIndex: 1, homePoints: 26, awayPoints: 17 }] });
  await assert.rejects(performAdminAction(f.db, f.admin, input), fails("VERSION_CONFLICT"));
  assert.equal((await readAdminTournament(f.db, f.admin)).cross.valid, false);
});

test("半决赛修正不覆盖已开打决赛，最终发布要求管理员核对实际对阵", async (t) => {
  const f = await fixture(t); await f.setup(8); await f.groups(); await f.cross();
  const state = await readAdminTournament(f.db, f.admin);
  for (const stage of ["PLACEMENT", "SEMIFINAL", "THIRD_PLACE", "FINAL"]) for (const match of state.matches.filter((row) => row.stage === stage)) await f.finish(match.code);
  await f.final();
  const finalCode = state.matches.find((match) => match.stage === "FINAL")!.code;
  const originalFinal = await f.db.match.findUniqueOrThrow({ where: { id: finalCode }, include: { sets: true } });
  const semiCode = state.matches.find((match) => match.stage === "SEMIFINAL")!.code;
  await f.score(semiCode, { type: "CORRECT_RESULT", sets: [{ setIndex: 1, homePoints: 11, awayPoints: 15 }, { setIndex: 2, homePoints: 13, awayPoints: 15 }] });
  assert.deepEqual(await f.db.match.findUniqueOrThrow({ where: { id: finalCode }, include: { sets: true } }), originalFinal);
  await assert.rejects(f.final(), fails("REVIEW_REQUIRED"));
  await f.final(true);
  const data = await readPublicSchedule(f.db); if (data.publication !== "published") assert.fail(); assert.equal(data.finalPublished, true);
});

test("升级既有阶段三数据库保留凭据、会话版本、比分与日志；重复迁移不改变数据", async (t) => {
  const f = await fixture(t);
  const oldRoot = path.join(f.directory, "old-version"); const migrationRoot = path.join(oldRoot, "prisma/four-v-four/migrations");
  await mkdir(migrationRoot, { recursive: true });
  for (const name of ["20261015000100_init", "20261015000200_scoring_start_proof"]) {
    await mkdir(path.join(migrationRoot, name)); await copyFile(path.join("prisma/four-v-four/migrations", name, "migration.sql"), path.join(migrationRoot, name, "migration.sql"));
  }
  const oldUrl = `file:${path.join(f.directory, "old.db")}`;
  await migrateFourVFour({ FOUR_V_FOUR_DATABASE_URL: oldUrl }, oldRoot);
  const oldDb = createFourVFourClient(oldUrl);
  await initializeTournament(oldDb, { mode: 8, name: "已有赛事" });
  await oldDb.credential.create({ data: { id: "preserved", role: "ADMIN", codeHash: "preserved-hash", version: 7 } });
  await oldDb.match.update({ where: { id: "M01" }, data: { status: "FINISHED", version: 4, winnerId: "team:A1", startedAt: new Date(), submittedAt: new Date() } });
  await oldDb.setScore.create({ data: { matchId: "M01", setIndex: 1, homePoints: 25, awayPoints: 19, confirmed: true } });
  await oldDb.auditLog.create({ data: { actor: "admin", operation: "OLD", subject: "M01", after: "{}" } });
  const preserved = { matches: await oldDb.match.findMany({ include: { sets: true } }), credentials: await oldDb.credential.findMany(), logs: await oldDb.auditLog.findMany(), teams: await oldDb.team.findMany() };
  await oldDb.$disconnect();
  await migrateFourVFour({ FOUR_V_FOUR_DATABASE_URL: oldUrl });
  assert.deepEqual(await migrateFourVFour({ FOUR_V_FOUR_DATABASE_URL: oldUrl }), []);
  const upgraded = createFourVFourClient(oldUrl); t.after(async () => { await upgraded.$disconnect(); });
  assert.equal((await upgraded.credential.findUniqueOrThrow({ where: { id: "preserved" } })).version, 7);
  assert.equal((await upgraded.credential.findUniqueOrThrow({ where: { id: "preserved" } })).codeHash, "preserved-hash");
  assert.deepEqual({ matches: await upgraded.match.findMany({ include: { sets: true } }), credentials: await upgraded.credential.findMany(), logs: await upgraded.auditLog.findMany(), teams: await upgraded.team.findMany() }, preserved);
  assert.ok((await readFile(path.join(migrationRoot, "20261015000100_init/migration.sql"), "utf8")).length > 0);
});
