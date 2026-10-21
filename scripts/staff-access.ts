import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { createFourVFourClient } from "../src/lib/four-v-four/database.ts";
import { generateAccessCode, setAccessCode } from "../src/lib/four-v-four/credentials.ts";
import { ACCESS_CODE_MAX_LENGTH, isValidAccessCode } from "../src/lib/four-v-four/access-code-policy.ts";

config({ path: process.env.NODE_ENV === "production" ? [".env.production.local", ".env.local", ".env.production", ".env"] : [".env.local", ".env"], quiet: true });
const target = process.argv[2];
if (!["all", "admin", "main", "secondary"].includes(target)) throw new Error("用法：npm run staff:access -- all|admin|main|secondary。会重置选定访问码并使其旧会话失效。");
const fromStdin = process.argv[3] === "--stdin";
if (process.argv.length > (fromStdin ? 4 : 3) || fromStdin && target === "all") throw new Error("--stdin仅支持单个身份：staff:access -- admin|main|secondary --stdin");
let specifiedCode = "";
if (fromStdin) {
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    specifiedCode += chunk;
    if (specifiedCode.length > ACCESS_CODE_MAX_LENGTH + 2) throw new Error("输入的访问码过长");
  }
  specifiedCode = specifiedCode.trim();
  if (!isValidAccessCode(specifiedCode)) throw new Error("输入的访问码长度应为3至64个字符");
}
const db = createFourVFourClient();
try {
  if (!(await db.tournament.findUnique({ where: { id: "current" } })) && target !== "admin") throw new Error("空库请先运行 staff:access -- admin，再从 /manage 初始化赛事；场地访问码在初始化后设置");
  if (!process.env.FOUR_V_FOUR_SESSION_SECRET) {
    if (process.env.NODE_ENV === "production") throw new Error("生产环境请先配置独立FOUR_V_FOUR_SESSION_SECRET，再生成访问码；不会自动写入本机环境文件");
    await appendFile(".env.local", `\nFOUR_V_FOUR_SESSION_SECRET=${randomBytes(48).toString("base64url")}\n`);
    console.log("已在本工程 .env.local 保存独立会话密钥，请重启网站使其生效。");
  } else if (process.env.FOUR_V_FOUR_SESSION_SECRET.length < 32) throw new Error("已有会话密钥长度不足，请在本工程环境配置中设置至少32字符的独立密钥");
  for (const role of (target === "all" ? ["admin", "main", "secondary"] : [target]) as ("admin" | "main" | "secondary")[]) {
    const code = fromStdin ? specifiedCode : generateAccessCode(); await setAccessCode(db, role, code);
    const label = role === "admin" ? "管理员" : role === "main" ? "主场地记分员" : "副场地记分员";
    console.log(fromStdin ? `${label}访问码已保存，旧会话已失效。` : `${label}访问码：${code}`);
  }
  console.log("请安全保存并分别交给对应人员；数据库仅保存散列，不保存明文访问码。");
} finally { await db.$disconnect(); }
