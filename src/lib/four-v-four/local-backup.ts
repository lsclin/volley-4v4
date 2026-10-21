import { createClient } from "@libsql/client";
import { constants } from "node:fs";
import { copyFile, mkdir, open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveFourVFourDatabaseUrl } from "./database-url.ts";
import type { DatabaseEnvironment } from "./database-url.ts";

function localPath(env: DatabaseEnvironment) {
  if (!env.FOUR_V_FOUR_DATABASE_URL?.startsWith("file:")) throw new Error("仅支持显式指定的独立本地SQLite库；云库请使用供应商备份恢复工具");
  const filename = resolveFourVFourDatabaseUrl(env).slice(5);
  const relative = path.relative(path.resolve("public"), filename);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("数据库及备份不得放入public静态公开目录");
  return filename;
}
async function validate(filename: string) {
  if (!(await stat(filename)).isFile()) throw new Error("数据库文件不存在");
  const db = createClient({ url: `file:${filename}` });
  try {
    const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    const allowed = new Set(["Tournament", "Team", "Court", "Match", "SetScore", "ScoreAction", "Approval", "Credential", "AuditLog", "_FourVFourMigration"]);
    if (tables.rows.some((row) => !allowed.has(String(row.name))) || !tables.rows.some((row) => row.name === "_FourVFourMigration")) throw new Error("拒绝处理非4v4数据库");
    const check = await db.execute("PRAGMA quick_check");
    if (check.rows.length !== 1 || Object.values(check.rows[0])[0] !== "ok" || (await db.execute("PRAGMA foreign_key_check")).rows.length) throw new Error("数据库完整性校验失败");
  } finally { db.close(); }
}
export async function backupLocalDatabase(env: DatabaseEnvironment, output: string) {
  const source = localPath(env);
  const target = localPath({ ...env, FOUR_V_FOUR_DATABASE_URL: `file:${path.resolve(output)}` });
  await validate(source);
  await mkdir(path.dirname(target), { recursive: true });
  // Reserve an empty private file; never replace any existing backup (even an empty one).
  const reserved = await open(target, "wx", 0o600); await reserved.close();
  const db = createClient({ url: `file:${source}` });
  try { await db.execute({ sql: "VACUUM INTO ?", args: [target] }); }
  finally { db.close(); }
  await validate(target);
  const handle = await open(target, "r+"); try { await handle.sync(); } finally { await handle.close(); }
  return { file: target, sha256: createHash("sha256").update(await readFile(target)).digest("hex") };
}
export async function restoreLocalDatabase(backup: string, targetEnv: DatabaseEnvironment) {
  const source = path.resolve(backup), target = localPath(targetEnv);
  await validate(source);
  await mkdir(path.dirname(target), { recursive: true });
  // Restore only into a new filename. Switching the service is an explicit operator step.
  await copyFile(source, target, constants.COPYFILE_EXCL);
  const handle = await open(target, "r+"); try { await handle.sync(); } finally { await handle.close(); }
  await validate(target);
  return { file: target, sha256: createHash("sha256").update(await readFile(target)).digest("hex") };
}
