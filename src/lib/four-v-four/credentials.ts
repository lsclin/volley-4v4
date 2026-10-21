import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PrismaClient } from "../../generated/four-v-four/index.js";
import type { Principal } from "./scoring-types.ts";
import { ScoringError } from "./scoring-types.ts";
import { ACCESS_CODE_MIN_LENGTH, ACCESS_CODE_MAX_LENGTH, isValidAccessCode } from "./access-code-policy.ts";

const derive = promisify(scrypt);
export function generateAccessCode() { return randomBytes(9).toString("base64url"); }
export async function hashAccessCode(code: string) {
  if (!isValidAccessCode(code)) throw new ScoringError("INVALID_CODE", `访问码长度应为${ACCESS_CODE_MIN_LENGTH}至${ACCESS_CODE_MAX_LENGTH}个字符`);
  const salt = randomBytes(16).toString("hex");
  const digest = await derive(code.trim(), salt, 64) as Buffer;
  return `scrypt:${salt}:${digest.toString("hex")}`;
}
export async function verifyAccessCode(code: string, stored: string) {
  const [method, salt, digest] = stored.split(":");
  if (method !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt ?? "") || !/^[a-f0-9]{128}$/.test(digest ?? "")) return false;
  const candidate = await derive(code.trim(), salt, 64) as Buffer;
  return timingSafeEqual(candidate, Buffer.from(digest, "hex"));
}
export async function setAccessCode(db: PrismaClient, target: "admin" | "main" | "secondary", code: string) {
  const codeHash = await hashAccessCode(code);
  return db.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({ where: { id: "current" } });
    if (!tournament && target !== "admin") throw new ScoringError("NOT_CONFIGURED", "请先初始化赛事，再设置场地访问码", 409);
    const existing = await tx.credential.findFirst({ where: target === "admin" ? { role: "ADMIN" } : { role: "SCORER", courtId: target } });
    const saved = existing ? await tx.credential.update({ where: { id: existing.id }, data: { codeHash, version: { increment: 1 } } })
      : await tx.credential.create({ data: { tournamentId: tournament?.id ?? null, role: target === "admin" ? "ADMIN" : "SCORER", courtId: target === "admin" ? null : target, codeHash } });
    if (tournament) await tx.auditLog.create({ data: { actor: "local-admin", operation: "RESET_ACCESS_CODE", subject: target, after: JSON.stringify({ credentialId: saved.id, version: saved.version }) } });
    return saved;
  });
}
export async function authenticateAccessCode(db: PrismaClient, code: string): Promise<Principal | null> {
  const credentials = await db.credential.findMany();
  const checks = await Promise.all(credentials.map((credential) => verifyAccessCode(code, credential.codeHash)));
  const found = credentials.filter((_, index) => checks[index]);
  if (found.length !== 1) return null;
  const { id, version, role, courtId } = found[0];
  return { id, version, role, courtId };
}
