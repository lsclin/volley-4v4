import { ScoringError } from "./scoring-types.ts";
export const PRIVATE_HEADERS = { "Cache-Control": "no-store, private", "Vary": "Cookie" };
export function staffJson(data: unknown, status = 200) { return Response.json(data, { status, headers: PRIVATE_HEADERS }); }
export function staffError(error: unknown) {
  if (error instanceof ScoringError) return staffJson({ error: { code: error.code, message: error.message }, ...(error.match ? { match: error.match } : {}) }, error.status);
  console.error("4v4 staff request failed", error && typeof error === "object" && "code" in error ? String(error.code) : "UNEXPECTED_ERROR");
  return staffJson({ error: { code: "SERVICE_UNAVAILABLE", message: "赛事服务暂不可用，请稍后用同一请求重试" } }, 503);
}
export async function readSmallJson(request: Request, limit = 8192) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (reader) {
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new ScoringError("INVALID_REQUEST", "请求内容过大", 413); } chunks.push(value); } }
    finally { reader.releaseLock(); }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(text); } catch { throw new ScoringError("INVALID_REQUEST", "请求内容不是有效JSON", 400); }
}
