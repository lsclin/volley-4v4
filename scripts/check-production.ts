import { config } from "dotenv";
import { productionConfigIssues } from "../src/lib/four-v-four/production-config.ts";
config({ path: [".env.production.local", ".env.local", ".env.production", ".env"], quiet: true });
const issues = productionConfigIssues(process.env);
if (issues.length) {
  for (const issue of issues) console.error(issue);
  process.exitCode = 1;
} else console.log("生产配置静态检查通过。未连接数据库；不代表云库、HTTPS代理或真机已经验收，不会执行部署。");
