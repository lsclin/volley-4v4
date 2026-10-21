import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { parse } from "dotenv";
import { createClient } from "@libsql/client";
import { createFourVFourClient } from "../src/lib/four-v-four/database.ts";
import { migrateFourVFour } from "../src/lib/four-v-four/migrate.ts";
import { setAccessCode, generateAccessCode } from "../src/lib/four-v-four/credentials.ts";
import { performScoreAction, readStaffMatch } from "../src/lib/four-v-four/scoring-service.ts";
import { initializeTournament, updateTeamNames, publishSchedule } from "../src/lib/four-v-four/repository.ts";

// Opt-in only: this command intentionally seeds a dedicated empty remote test DB.
if (!process.argv.includes("--empty-dedicated-test-database")) throw new Error("此检查会写入测试赛事；仅可对专用空库运行，并显式传入 --empty-dedicated-test-database");
const env = parse(await readFile(".env.cloud-test.local"));
if (!env.FOUR_V_FOUR_DATABASE_URL?.startsWith("libsql://") || !env.FOUR_V_FOUR_AUTH_TOKEN) throw new Error("请在 .env.cloud-test.local 配置专用libSQL云库地址和令牌");
const raw = createClient({ url: env.FOUR_V_FOUR_DATABASE_URL, authToken: env.FOUR_V_FOUR_AUTH_TOKEN });
try {
  const tables = await raw.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  if (tables.rows.length) throw new Error("云端目标不是空库，拒绝修改；请准备另一套专用空测试库");
} finally { raw.close(); }
const applied = await migrateFourVFour(env); assert.equal((await migrateFourVFour(env)).length, 0);
const db = createFourVFourClient(env.FOUR_V_FOUR_DATABASE_URL, env.FOUR_V_FOUR_AUTH_TOKEN);
let matchVersion = 0;
try {
  await initializeTournament(db, { mode: 8 }, "cloud-test");
  const teams = await db.team.findMany(); await updateTeamNames(db, Object.fromEntries(teams.map((team) => [team.drawCode, `云端测试${team.drawCode}`])), 0, "cloud-test");
  await publishSchedule(db, 1, "cloud-test");
  const { id, version, role, courtId } = await setAccessCode(db, "main", generateAccessCode()); const actor = { id, version, role, courtId };
  const marker = `rollback-${randomUUID()}`;
  const sentinel = new Error("expected-rollback");
  await assert.rejects(db.$transaction(async (tx) => { await tx.auditLog.create({ data: { actor: "cloud-test", operation: marker, subject: "transaction", after: "{}" } }); throw sentinel; }), sentinel);
  assert.equal(await db.auditLog.count({ where: { operation: marker } }), 0);
  await performScoreAction(db, actor, "M01", { requestId: randomUUID(), expectedVersion: 0, action: { type: "START" } });
  const command = { requestId: randomUUID(), expectedVersion: 1, action: { type: "POINT" as const, setIndex: 1, side: "home" as const, delta: 1 as const } };
  await performScoreAction(db, actor, "M01", command); assert.equal((await performScoreAction(db, actor, "M01", command)).receipt.replayed, true);
  const match = await readStaffMatch(db, actor, "M01"); assert.equal(match.sets[0].homePoints, 1); matchVersion = match.version;
} finally { await db.$disconnect(); }
const reconnect = createFourVFourClient(env.FOUR_V_FOUR_DATABASE_URL, env.FOUR_V_FOUR_AUTH_TOKEN);
try { assert.equal((await reconnect.match.findUniqueOrThrow({ where: { id: "M01" } })).version, matchVersion); }
finally { await reconnect.$disconnect(); }
console.log(JSON.stringify({ passed: true, migrations: applied, checks: ["独立空库保护", "迁移及重复跳过", "真实读写", "事务回滚", "记分事务与幂等", "重连持久化"], note: "测试数据保留在专用云测试库；仍需后续完整现场联调。" }, null, 2));
