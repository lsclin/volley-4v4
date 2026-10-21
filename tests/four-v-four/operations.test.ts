import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { productionConfigIssues } from "../../src/lib/four-v-four/production-config.ts";
import { backupLocalDatabase, restoreLocalDatabase } from "../../src/lib/four-v-four/local-backup.ts";
import { createFourVFourClient } from "../../src/lib/four-v-four/database.ts";
import { migrateFourVFour } from "../../src/lib/four-v-four/migrate.ts";
import { prepareReviewFixture } from "../fixtures/review.ts";
import { setAccessCode } from "../../src/lib/four-v-four/credentials.ts";

test("生产配置只读校验：独立持久库、HTTPS源、密钥、禁用HTTP例外及公开环境变量防泄露", () => {
  const valid = { FOUR_V_FOUR_DATABASE_URL: `file:${path.resolve('data/isolated-production-example.db')}`, FOUR_V_FOUR_SESSION_SECRET: 'production-example-secret-for-validation-only', FOUR_V_FOUR_SITE_ORIGIN: 'https://volley.example.com' };
  assert.deepEqual(productionConfigIssues(valid), []);
  assert.ok(productionConfigIssues({}).length >= 3);
  for (const patch of [{ FOUR_V_FOUR_ALLOW_LOCAL_HTTP: '1' }, { FOUR_V_FOUR_SITE_ORIGIN: 'http://volley.example.com' }, { FOUR_V_FOUR_SITE_ORIGIN: 'https://volley.example.com/path' }, { FOUR_V_FOUR_DATABASE_URL: 'file:./data/relative.db' }, { FOUR_V_FOUR_DATABASE_URL: valid.FOUR_V_FOUR_DATABASE_URL, DATABASE_URL: valid.FOUR_V_FOUR_DATABASE_URL }, { NEXT_PUBLIC_FOUR_V_FOUR_AUTH_TOKEN: 'private-example' }]) assert.ok(productionConfigIssues({ ...valid, ...patch }).length);
  assert.ok(productionConfigIssues({ ...valid, FOUR_V_FOUR_DATABASE_URL: 'libsql://dedicated-test.turso.io' }).length);
  assert.deepEqual(productionConfigIssues({ ...valid, FOUR_V_FOUR_DATABASE_URL: 'libsql://dedicated-test.turso.io', FOUR_V_FOUR_AUTH_TOKEN: 'example-not-a-real-token' }), []);
  assert.ok(!JSON.stringify(productionConfigIssues({ ...valid, NEXT_PUBLIC_FOUR_V_FOUR_AUTH_TOKEN: 'private-example' })).includes('private-example'));
  assert.ok(productionConfigIssues({ ...valid, FOUR_V_FOUR_DATABASE_URL: `file:${path.resolve('public/event.db')}` }).length);
});

for (const mode of [8, 10] as const) test(`${mode}队：一致备份、恢复到新文件、完整名次/比分/凭据/审计/幂等记录保留与迁移可重入`, async (t) => {
  const directory = await mkdtemp(path.join(process.env.FOUR_V_FOUR_TEST_ROOT!, 'backup-'));
  const env = { FOUR_V_FOUR_DATABASE_URL: `file:${path.join(directory, 'source.db')}` };
  await migrateFourVFour(env); const db = createFourVFourClient(env.FOUR_V_FOUR_DATABASE_URL);
  t.after(async () => { await db.$disconnect(); });
  await prepareReviewFixture(db, mode, 'final-published'); await setAccessCode(db, 'admin', 'review-backup-admin-code');
  await db.scoreAction.create({ data: { requestId: `preserved-${mode}`, matchId: 'M01', actor: 'test', operation: 'POINT', payload: '{}', before: '{}', after: '{}', expectedVersion: 0, resultingVersion: 1 } });
  const before = { teams: await db.team.findMany(), matches: await db.match.findMany({ include: { sets: true } }), approvals: await db.approval.findMany(), actions: await db.scoreAction.findMany(), credentials: await db.credential.findMany(), audit: await db.auditLog.findMany() };
  const backup = path.join(directory, 'backup.db');
  const result = await backupLocalDatabase(env, backup);
  await assert.rejects(backupLocalDatabase(env, backup), /EEXIST/);
  const restoreEnv = { FOUR_V_FOUR_DATABASE_URL: `file:${path.join(directory, 'restored.db')}` };
  const restored = await restoreLocalDatabase(backup, restoreEnv); assert.equal(restored.sha256, result.sha256);
  await assert.rejects(restoreLocalDatabase(backup, restoreEnv), /EEXIST/);
  assert.deepEqual(await migrateFourVFour(restoreEnv), []);
  const other = createFourVFourClient(restoreEnv.FOUR_V_FOUR_DATABASE_URL); t.after(async () => { await other.$disconnect(); });
  assert.deepEqual({ teams: await other.team.findMany(), matches: await other.match.findMany({ include: { sets: true } }), approvals: await other.approval.findMany(), actions: await other.scoreAction.findMany(), credentials: await other.credential.findMany(), audit: await other.auditLog.findMany() }, before);
  assert.ok((await readFile(backup)).length > 0);
});

test("备份恢复拒绝云库、缺少显式目标、非4v4文件及覆盖已有文件", async () => {
  await assert.rejects(backupLocalDatabase({}, 'ignored.db'), /显式/);
  await assert.rejects(backupLocalDatabase({ FOUR_V_FOUR_DATABASE_URL: 'libsql://not-used.example' }, 'ignored.db'), /本地/);
  await assert.rejects(backupLocalDatabase({ FOUR_V_FOUR_DATABASE_URL: `file:${path.resolve('public/forbidden.db')}` }, 'ignored.db'), /public/);
  const directory = await mkdtemp(path.join(process.env.FOUR_V_FOUR_TEST_ROOT!, 'bad-backup-'));
  const source = path.join(directory, 'not-database.db'); await writeFile(source, 'not a database');
  await assert.rejects(restoreLocalDatabase(source, { FOUR_V_FOUR_DATABASE_URL: `file:${path.join(directory, 'new.db')}` }));
});

test("生产维护命令使用生产环境文件，检查命令不连接数据库或输出密钥", async (t) => {
  const directory = await mkdtemp(path.join(process.env.FOUR_V_FOUR_TEST_ROOT!, 'production-cli-'));
  const url = `file:${path.join(directory, 'production.db')}`;
  await migrateFourVFour({ FOUR_V_FOUR_DATABASE_URL: url });
  const db = createFourVFourClient(url); t.after(async () => { await db.$disconnect(); });
  const { initializeTournament } = await import('../../src/lib/four-v-four/repository.ts');
  await initializeTournament(db, { mode: 8, name: 'production-target-only' });
  const secret = 'production-cli-test-secret-not-a-real-secret';
  await writeFile(path.join(directory, '.env'), 'FOUR_V_FOUR_DATABASE_URL="file:./wrong-local.db"\n');
  await writeFile(path.join(directory, '.env.production.local'), `FOUR_V_FOUR_DATABASE_URL=${JSON.stringify(url.replaceAll('\\', '/'))}\nFOUR_V_FOUR_SESSION_SECRET=${secret}\nFOUR_V_FOUR_SITE_ORIGIN=https://volley.example.com\n`);
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' }; delete env.FOUR_V_FOUR_DATABASE_URL; delete env.FOUR_V_FOUR_SESSION_SECRET; delete env.FOUR_V_FOUR_SITE_ORIGIN; delete env.FOUR_V_FOUR_ALLOW_LOCAL_HTTP;
  const inspect = execFileSync(process.execPath, ['--experimental-strip-types', path.resolve('scripts/four-v-four-admin.ts'), 'inspect'], { cwd: directory, env, encoding: 'utf8', windowsHide: true });
  assert.equal(JSON.parse(inspect).name, 'production-target-only');
  const checked = execFileSync(process.execPath, ['--experimental-strip-types', path.resolve('scripts/check-production.ts')], { cwd: directory, env, encoding: 'utf8', windowsHide: true });
  assert.match(checked, /检查通过/); assert.ok(!checked.includes(secret)); assert.equal(await db.match.count(), 18);
});
