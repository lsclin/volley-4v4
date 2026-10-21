import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getFourVFourDatabase } from "./database.ts";
import { ScoringError } from "./scoring-types.ts";
import type { Principal } from "./scoring-types.ts";
import { assertPrincipal } from "./scoring-service.ts";
export { assertSameOrigin } from "./staff-origin.ts";

interface SessionData { credentialId?: string; credentialVersion?: number }
const COOKIE = "ustc-4v4-session";
export async function staffSession(request: Request) {
  const password = process.env.FOUR_V_FOUR_SESSION_SECRET;
  if (!password || password.length < 32) throw new ScoringError("AUTH_NOT_CONFIGURED", "管理入口尚未配置，请联系管理员", 503);
  const hostname = new URL(`http://${request.headers.get("host") ?? new URL(request.url).host}`).hostname;
  const allowLocalHttp = process.env.FOUR_V_FOUR_ALLOW_LOCAL_HTTP === "1" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  return getIronSession<SessionData>(await cookies(), { password, cookieName: COOKIE, ttl: 12 * 60 * 60,
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production" && !allowLocalHttp, sameSite: "strict", path: "/" } });
}
export async function sessionPrincipal(request: Request, required = true): Promise<Principal | null> {
  const store = await cookies();
  if (!store.has(COOKIE)) {
    if (required) throw new ScoringError("UNAUTHORIZED", "请先输入访问码登录", 401);
    return null;
  }
  const session = await staffSession(request);
  if (!session.credentialId || !Number.isInteger(session.credentialVersion)) {
    if (required) throw new ScoringError("UNAUTHORIZED", "会话已失效，请重新登录", 401);
    return null;
  }
  const db = getFourVFourDatabase();
  const row = await db.credential.findUnique({ where: { id: session.credentialId } });
  if (!row || row.version !== session.credentialVersion) {
    if (required) throw new ScoringError("SESSION_EXPIRED", "访问码已重置，请重新登录", 401);
    return null;
  }
  return assertPrincipal(db, { id: row.id, version: row.version, role: row.role, courtId: row.courtId });
}
// A small process-local cap for this single event; no separate rate-limit infrastructure.
let loginWindow = { since: 0, count: 0 };
export function checkLoginRate(now = Date.now()) {
  if (now - loginWindow.since >= 60_000) loginWindow = { since: now, count: 0 };
  if (++loginWindow.count > 30) throw new ScoringError("TOO_MANY_ATTEMPTS", "尝试过于频繁，请稍后重试", 429);
}
