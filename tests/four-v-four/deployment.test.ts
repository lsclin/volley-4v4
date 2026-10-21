import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isValidAccessCode } from "../../src/lib/four-v-four/access-code-policy.ts";
import { resolveFourVFourDatabaseUrl } from "../../src/lib/four-v-four/database-url.ts";
import { productionConfigIssues } from "../../src/lib/four-v-four/production-config.ts";
import { createFourVFourClient } from "../../src/lib/four-v-four/database.ts";
import { migrateFourVFour } from "../../src/lib/four-v-four/migrate.ts";
import { authenticateAccessCode } from "../../src/lib/four-v-four/credentials.ts";
import { initializeTournament } from "../../src/lib/four-v-four/repository.ts";
import { stripBuildEnvironment } from "../../scripts/cloudflare-build-output.mjs";

test("Cloudflare产物清除本机环境默认值，未知格式拒绝继续", async () => {
  const directory = await mkdtemp(path.join(process.env.FOUR_V_FOUR_TEST_ROOT!, "build-env-"));
  await mkdir(path.join(directory, "cloudflare"));
  await mkdir(path.join(directory, "server-functions/default"), { recursive: true });
  const copiedEnv = path.join(directory, "server-functions/default/.env.local");
  await writeFile(copiedEnv, "SESSION_SECRET=private-build-test-value");
  const file = path.join(directory, "cloudflare/next-env.mjs");
  await writeFile(file, 'export const production = {"SESSION_SECRET":"private-build-test-value"};\nexport const development = {"DATABASE_URL":"file:local-test.db"};\nexport const test = {};\n');
  await stripBuildEnvironment(directory);
  const cleaned = await readFile(file, "utf8");
  assert.ok(!cleaned.includes("private-build-test-value") && !cleaned.includes("local-test.db"));
  assert.match(cleaned, /export const production = \{\}/);
  await assert.rejects(readFile(copiedEnv), { code: "ENOENT" });
  await writeFile(file, "unknown adapter format");
  await assert.rejects(stripBuildEnvironment(directory), /未知OpenNext/);
});

test("开发与生产共用密码边界，不再拒绝已指定的3/4位密码", () => {
  for (const value of ["ustc", "111", "222", " padded ", "a".repeat(64)]) assert.equal(isValidAccessCode(value), true);
  for (const value of [null, 123, "", "ab", "   ", "a".repeat(65)]) assert.equal(isValidAccessCode(value), false);
});

test("Cloudflare目标拒绝本地SQLite、默认回退及未知目标；保留旧站云库隔离", () => {
  const env = { FOUR_V_FOUR_DEPLOY_TARGET: "cloudflare", FOUR_V_FOUR_DATABASE_URL: "libsql://dedicated-4v4.example" };
  assert.equal(resolveFourVFourDatabaseUrl(env), env.FOUR_V_FOUR_DATABASE_URL);
  assert.throws(() => resolveFourVFourDatabaseUrl({ FOUR_V_FOUR_DEPLOY_TARGET: "cloudflare" }), /Cloudflare/);
  assert.throws(() => resolveFourVFourDatabaseUrl({ ...env, FOUR_V_FOUR_DATABASE_URL: "file:./data/test.db" }), /Cloudflare/);
  assert.throws(() => resolveFourVFourDatabaseUrl({ ...env, FOUR_V_FOUR_DEPLOY_TARGET: "misspelled" }), /部署目标/);
  assert.throws(() => resolveFourVFourDatabaseUrl({ ...env, DATABASE_URL: env.FOUR_V_FOUR_DATABASE_URL }), /隔离/);
  assert.throws(() => resolveFourVFourDatabaseUrl({ ...env, FOUR_V_FOUR_DATABASE_URL: "https://example.test" }));
  const valid = { ...env, FOUR_V_FOUR_AUTH_TOKEN: "test-token-not-real", FOUR_V_FOUR_SESSION_SECRET: "test-only-secret-that-is-long-enough", FOUR_V_FOUR_SITE_ORIGIN: "https://volley.example.com" };
  assert.deepEqual(productionConfigIssues(valid), []);
  assert.ok(productionConfigIssues({ ...valid, FOUR_V_FOUR_AUTH_TOKEN: "" }).length);
  assert.ok(productionConfigIssues({ ...valid, FOUR_V_FOUR_DATABASE_URL: "file:/tmp/event.db" }).length);
});

test("生产CLI可通过标准输入设置指定短码，不回显密码、密钥，不改队伍/赛程", async (t) => {
  const directory = await mkdtemp(path.join(process.env.FOUR_V_FOUR_TEST_ROOT!, "production-password-"));
  const url = `file:${path.join(directory, "event.db")}`;
  await migrateFourVFour({ FOUR_V_FOUR_DATABASE_URL: url });
  const db = createFourVFourClient(url); t.after(() => db.$disconnect());
  await initializeTournament(db, { mode: 8, name: "密码初始化隔离测试" });
  const before = { teams: await db.team.findMany(), matches: await db.match.findMany() };
  const secret = "isolated-password-test-session-secret";
  await writeFile(path.join(directory, ".env.production.local"), `FOUR_V_FOUR_DATABASE_URL=${JSON.stringify(url.replaceAll("\\", "/"))}\nFOUR_V_FOUR_SESSION_SECRET=${secret}\n`);
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
  for (const key of ["FOUR_V_FOUR_DATABASE_URL", "FOUR_V_FOUR_AUTH_TOKEN", "FOUR_V_FOUR_SESSION_SECRET", "FOUR_V_FOUR_DEPLOY_TARGET", "DOTENV_CONFIG_PATH"]) delete env[key];
  for (const [target, password] of [["admin", "ustc"], ["main", "111"], ["secondary", "222"]]) {
    const output = execFileSync(process.execPath, ["--experimental-strip-types", path.resolve("scripts/staff-access.ts"), target, "--stdin"], { cwd: directory, env, input: `${password}\n`, encoding: "utf8", windowsHide: true });
    assert.ok(!output.includes(password)); assert.ok(!output.includes(secret));
    const principal = await authenticateAccessCode(db, password);
    assert.equal(principal?.role, target === "admin" ? "ADMIN" : "SCORER");
    assert.equal(principal?.courtId, target === "admin" ? null : target);
  }
  assert.deepEqual({ teams: await db.team.findMany(), matches: await db.match.findMany() }, before);
  const logs = JSON.stringify(await db.auditLog.findMany());
  assert.ok(!logs.includes('"ustc"') && !logs.includes('"111"') && !logs.includes('"222"'));
});
