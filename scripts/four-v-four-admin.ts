import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { createFourVFourClient } from "../src/lib/four-v-four/database.ts";
import { initializeTournament, publishSchedule, readAdminSetup, updateTeamNames, updateTournamentText } from "../src/lib/four-v-four/repository.ts";

const [command, value, revision] = process.argv.slice(2);
config({ path: process.env.NODE_ENV === "production" ? [".env.production.local", ".env.local", ".env.production", ".env"] : [".env.local", ".env"], quiet: true });
const db = createFourVFourClient();
try {
  switch (command) {
    case "init": await initializeTournament(db, { mode: Number(value) }); break;
    case "teams": {
      const names: unknown = JSON.parse(await readFile(value, "utf8"));
      if (!names || typeof names !== "object" || Array.isArray(names)) throw new Error("队名文件必须是编号到名称的JSON对象");
      await updateTeamNames(db, names as Record<string, string>, Number(revision)); break;
    }
    case "config": {
      const input = JSON.parse(await readFile(value, "utf8"));
      await updateTournamentText(db, input, Number(revision)); break;
    }
    case "publish": await publishSchedule(db, Number(value)); break;
    case "inspect": console.log(JSON.stringify(await readAdminSetup(db), null, 2)); break;
    default: throw new Error("用法：init 8|10 / inspect / teams 队名.json 当前revision / config 设置.json 当前revision / publish 当前revision");
  }
  if (command !== "inspect") console.log("操作已保存到独立4v4数据库");
} catch (error) {
  console.error(error instanceof Error ? error.message : "操作失败"); process.exitCode = 1;
} finally { await db.$disconnect(); }
