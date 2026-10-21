import path from "node:path";
import { resolveFourVFourDatabaseUrl } from "./database-url.ts";
import type { DatabaseEnvironment } from "./database-url.ts";

// Configuration-only check: never connects to or changes any database, never returns secrets.
export function productionConfigIssues(env: DatabaseEnvironment): string[] {
  const issues: string[] = [];
  if ((env.FOUR_V_FOUR_SESSION_SECRET?.trim().length ?? 0) < 32) issues.push("FOUR_V_FOUR_SESSION_SECRET需要至少32字符的独立随机密钥");
  if (env.FOUR_V_FOUR_ALLOW_LOCAL_HTTP === "1") issues.push("正式生产环境必须关闭FOUR_V_FOUR_ALLOW_LOCAL_HTTP");
  try {
    const origin = new URL(env.FOUR_V_FOUR_SITE_ORIGIN ?? "");
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" || ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) throw new Error();
  } catch { issues.push("FOUR_V_FOUR_SITE_ORIGIN需要独立站点的HTTPS源地址，不能含路径、查询参数或账号"); }
  const url = env.FOUR_V_FOUR_DATABASE_URL?.trim();
  if (!url) issues.push("必须显式配置独立FOUR_V_FOUR_DATABASE_URL");
  else {
    try { resolveFourVFourDatabaseUrl({ ...env, NODE_ENV: "production" }); }
    catch { issues.push("数据库地址无效或与旧站冲突"); }
    if (url.startsWith("file:") && !path.isAbsolute(url.slice(5))) issues.push("生产SQLite使用持久磁盘上的绝对路径，避免工作目录变化创建另一份库");
    if (url.startsWith("file:")) {
      const relative = path.relative(path.resolve("public"), path.resolve(url.slice(5)));
      if (!relative.startsWith("..") && !path.isAbsolute(relative)) issues.push("数据库不能位于网站public静态公开目录");
    }
    if (url.startsWith("libsql://") && !env.FOUR_V_FOUR_AUTH_TOKEN?.trim()) issues.push("libSQL生产连接需要独立FOUR_V_FOUR_AUTH_TOKEN");
  }
  if (Object.keys(env).some((key) => key.startsWith("NEXT_PUBLIC_") && /SECRET|TOKEN|ACCESS_CODE|DATABASE_URL/.test(key) && env[key])) issues.push("不得通过NEXT_PUBLIC_*向浏览器公开密钥、访问码或数据库连接");
  return issues;
}
