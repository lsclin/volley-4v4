import path from "node:path";
import { mkdir, access, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { createFourVFourClient } from "../src/lib/four-v-four/database.ts";
import { migrateFourVFour } from "../src/lib/four-v-four/migrate.ts";
import { assertMode } from "../src/lib/four-v-four/types.ts";
import { prepareReviewFixture } from "../tests/fixtures/review.ts";
import type { ReviewScenario } from "../tests/fixtures/review.ts";
import { setAccessCode } from "../src/lib/four-v-four/credentials.ts";

config({ path: [".env.local", ".env"], quiet: true });
const mode = Number(process.argv[2] ?? 8);
assertMode(mode);
const scenario = process.argv[3] ?? "live";
if (!["live", "interval", "cross", "cross-upcoming", "final-pending", "final-published", "upcoming"].includes(scenario)) throw new Error("不支持的测试场景");
const directory = path.resolve("data/review");
await mkdir(directory, { recursive: true });
const filename = path.join(directory, `${mode}-${scenario}-${Date.now()}.db`);
try { await access(filename); throw new Error("测试库已存在，拒绝覆盖"); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
const url = `file:${filename}`;
await migrateFourVFour({ FOUR_V_FOUR_DATABASE_URL: url });
const db = createFourVFourClient(url, undefined);
try {
  await prepareReviewFixture(db, mode, scenario as ReviewScenario);
  let scoring;
  if (process.argv.includes("--scoring")) {
    const codes = { admin: "ReviewAdmin2026", main: "ReviewMain2026", secondary: "ReviewSide2026" };
    for (const target of ["admin", "main", "secondary"] as const) await setAccessCode(db, target, codes[target]);
    const environmentFile = filename.replace(/\.db$/, ".env.local");
    await writeFile(environmentFile, `FOUR_V_FOUR_DATABASE_URL=${JSON.stringify(url.replaceAll("\\", "/"))}\nFOUR_V_FOUR_SESSION_SECRET=${randomBytes(48).toString("base64url")}\nFOUR_V_FOUR_ALLOW_LOCAL_HTTP=1\n`, { flag: "wx" });
    scoring = { environmentFile, codes, warning: "仅用于隔离测试库，禁止在真实赛事使用这些固定访问码。" };
  }
  console.log(JSON.stringify({ mode, scenario, databaseUrl: url, ...scoring, note: "独立测试数据库，不修改默认赛事库。" }, null, 2));
} finally { await db.$disconnect(); }
