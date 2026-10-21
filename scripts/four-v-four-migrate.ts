import { config } from "dotenv";
import { migrateFourVFour } from "../src/lib/four-v-four/migrate.ts";

config({ path: process.env.NODE_ENV === "production" ? [".env.production.local", ".env.local", ".env.production", ".env"] : [".env.local", ".env"], quiet: true });

try {
  const applied = await migrateFourVFour(process.env);
  console.log(applied.length ? `4v4独立迁移已应用：${applied.join(", ")}` : "4v4数据库已是最新版本");
} catch (error) {
  console.error(error instanceof Error ? error.message : "4v4迁移失败"); process.exitCode = 1;
}
