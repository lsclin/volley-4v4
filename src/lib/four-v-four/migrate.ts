import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { resolveFourVFourDatabaseUrl } from "./database-url.ts";
import type { DatabaseEnvironment } from "./database-url.ts";

export async function migrateFourVFour(env: DatabaseEnvironment, cwd = process.cwd()) {
  const url = resolveFourVFourDatabaseUrl(env, cwd);
  if (url.startsWith("file:")) await mkdir(path.dirname(url.slice(5)), { recursive: true });
  const client = createClient({ url, authToken: env.FOUR_V_FOUR_AUTH_TOKEN });
  try {
    await client.execute("PRAGMA foreign_keys = ON");
    const allowed = new Set(["Tournament", "Team", "Court", "Match", "SetScore", "ScoreAction", "Approval", "Credential", "AuditLog", "_FourVFourMigration"]);
    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
    if (tables.rows.some((row) => !allowed.has(String(row.name)))) throw new Error("目标数据库包含非4v4数据表，拒绝执行迁移");
    // Do not adopt an existing, untracked schema (e.g. a copied legacy database).
    if (tables.rows.length && !tables.rows.some((row) => row.name === "_FourVFourMigration")) throw new Error("目标数据库已有未登记的结构，拒绝覆盖");
    await client.execute('CREATE TABLE IF NOT EXISTS "_FourVFourMigration" ("name" TEXT PRIMARY KEY, "checksum" TEXT NOT NULL, "appliedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const directory = path.resolve(cwd, "prisma/four-v-four/migrations");
    const folders = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const applied: string[] = [];
    for (const folder of folders) {
      const sql = await readFile(path.join(directory, folder, "migration.sql"), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const tx = await client.transaction("write");
      try {
        const existing = await tx.execute({ sql: 'SELECT "checksum" FROM "_FourVFourMigration" WHERE "name" = ?', args: [folder] });
        if (existing.rows.length) {
          if (existing.rows[0].checksum !== checksum) throw new Error("已执行的4v4迁移校验不一致，请新增迁移而非修改历史文件");
        } else {
          await tx.executeMultiple(sql);
          await tx.execute({ sql: 'INSERT INTO "_FourVFourMigration" ("name", "checksum") VALUES (?, ?)', args: [folder, checksum] });
          applied.push(folder);
        }
        await tx.commit();
      } catch (error) { await tx.rollback(); throw error; }
      finally { tx.close(); }
    }
    return applied;
  } finally { client.close(); }
}
