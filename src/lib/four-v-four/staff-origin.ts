import { ScoringError } from "./scoring-types.ts";

export function assertSameOrigin(request: Request, configured = process.env.FOUR_V_FOUR_SITE_ORIGIN) {
  // Next may normalize request.url to localhost internally. The browser's Host
  // header identifies the actual local/LAN origin; deployed proxies use explicit config.
  const url = new URL(request.url);
  const host = request.headers.get("host");
  const expected = configured ? new URL(configured).origin : host ? new URL(`${url.protocol}//${host}`).origin : url.origin;
  if (request.headers.get("origin") !== expected) throw new ScoringError("BAD_ORIGIN", "请求来源不正确，请从本站页面操作", 403);
}
