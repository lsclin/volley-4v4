import path from "node:path";
import { realpathSync } from "node:fs";

function identity(url: string, cwd: string): string {
  if (url.startsWith("file:")) {
    const raw = url.slice(5).split("?")[0];
    if (!raw || raw === ":memory:") throw new Error("4v4需要独立的持久数据库文件");
    const absolute = path.resolve(cwd, raw);
    // Resolve existing parents as well, so a directory junction cannot bypass isolation.
    let parent = absolute;
    const tail: string[] = [];
    while (true) {
      try {
        const result = path.join(realpathSync(parent), ...tail.reverse());
        return process.platform === "win32" ? result.toLowerCase() : result;
      } catch {
        const next = path.dirname(parent);
        if (next === parent) return process.platform === "win32" ? absolute.toLowerCase() : absolute;
        tail.push(path.basename(parent)); parent = next;
      }
    }
  }
  const remote = new URL(url);
  return `${remote.protocol}//${remote.host.toLowerCase()}${remote.pathname.replace(/\/$/, "")}`;
}

export type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

export function resolveFourVFourDatabaseUrl(env: DatabaseEnvironment, cwd = process.cwd()): string {
  const configured = env.FOUR_V_FOUR_DATABASE_URL?.trim() || "file:./data/four-v-four.db";
  const targetPlatform = env.FOUR_V_FOUR_DEPLOY_TARGET;
  if (targetPlatform && !["node", "cloudflare"].includes(targetPlatform)) throw new Error("未知的4v4部署目标");
  if (targetPlatform === "cloudflare" && !configured.startsWith("libsql://")) throw new Error("Cloudflare必须配置独立libSQL云库，不能回退到本地SQLite");
  if (!configured.startsWith("file:") && !configured.startsWith("libsql://")) throw new Error("4v4仅支持SQLite或libSQL数据库");
  const target = identity(configured, cwd);
  const legacy = env.DATABASE_URL?.trim();
  const protectedFiles = ["dev.db", "prisma/dev.db", "auth", "db"].map((file) => identity(`file:${file}`, cwd));
  if (protectedFiles.includes(target) || (legacy && identity(legacy, cwd) === target)) throw new Error("4v4数据库必须与旧站数据库隔离");
  if (env.NODE_ENV === "production" && !env.FOUR_V_FOUR_DATABASE_URL?.trim()) throw new Error("生产环境必须配置独立FOUR_V_FOUR_DATABASE_URL");
  if (configured.startsWith("file:") && configured.includes("?")) throw new Error("本地数据库路径不接受查询参数");
  return configured.startsWith("file:") ? `file:${path.resolve(cwd, configured.slice(5))}` : configured;
}
