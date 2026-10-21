import { config } from "dotenv";
import { backupLocalDatabase, restoreLocalDatabase } from "../src/lib/four-v-four/local-backup.ts";
config({ path: process.env.NODE_ENV === "production" ? [".env.production.local", ".env.local", ".env.production", ".env"] : [".env.local", ".env"], quiet: true });
const [operation, filename] = process.argv.slice(2);
try {
  if (!filename || !["backup", "restore"].includes(operation)) throw new Error("用法：npm run db:backup -- 新备份.db，或FOUR_V_FOUR_DATABASE_URL指定新文件后 npm run db:restore -- 备份.db。拒绝覆盖已有文件。");
  const result = operation === "backup" ? await backupLocalDatabase(process.env, filename) : await restoreLocalDatabase(filename, process.env);
  console.log(JSON.stringify({ ...result, note: operation === "backup" ? "仅包含服务器已同步数据；请将备份放在受限、非公开目录。" : "已恢复至新文件，未切换服务；核对后按部署说明撤销旧会话并人工切换。" }));
} catch (error) {
  console.error(error instanceof Error && /EEXIST/.test(error.message) ? "目标文件已存在，拒绝覆盖" : "备份/恢复未完成：请检查显式独立本地库、文件权限、完整性及新目标路径；不应使用或切换到失败的输出文件。");
  process.exitCode = 1;
}
