import type { Prisma, PrismaClient } from "../../generated/four-v-four/index.js";
import { matchTitle } from "./public-logic.ts";
import type { PublicMatch } from "./public-types.ts";
import { reduceScore } from "./scoring-rules.ts";
import { scoreCommandSchema } from "./scoring-validation.ts";
import { ScoringError } from "./scoring-types.ts";
import type { Principal, ScoreCommand, ScoreResponse, ScoringState, StaffMatch } from "./scoring-types.ts";

type Reader = Pick<PrismaClient, "credential" | "match" | "tournament" | "approval" | "team">;
type Row = Prisma.MatchGetPayload<{ include: { sets: true; court: true; homeTeam: true; awayTeam: true } }>;
const include = { sets: { orderBy: { setIndex: "asc" as const } }, court: true, homeTeam: true, awayTeam: true } as const;

export async function assertPrincipal(db: Reader, principal: Principal): Promise<Principal> {
  const credential = await db.credential.findUnique({ where: { id: principal.id } });
  if (!credential || credential.version !== principal.version || credential.role !== principal.role || credential.courtId !== principal.courtId) throw new ScoringError("SESSION_EXPIRED", "访问码已重置或会话失效，请重新登录", 401);
  return { id: credential.id, version: credential.version, role: credential.role, courtId: credential.courtId };
}
function assertCourt(principal: Principal, courtId: string) {
  if (principal.role !== "ADMIN" && principal.courtId !== courtId) throw new ScoringError("FORBIDDEN", "没有操作这片场地的权限", 403);
}
function stateOf(row: Row): ScoringState {
  return { code: row.code, courtId: row.courtId, stage: row.stage, format: row.format, status: row.status,
    version: row.version, homeTeamId: row.homeTeamId, awayTeamId: row.awayTeamId, winnerId: row.winnerId,
    startedAt: row.startedAt?.toISOString() ?? null, submittedAt: row.submittedAt?.toISOString() ?? null,
    crossApprovalIdAtStart: row.crossApprovalIdAtStart,
    sets: row.sets.map(({ setIndex, homePoints, awayPoints, confirmed, excluded, exclusionReason }) => ({ setIndex, homePoints, awayPoints, confirmed, excluded, exclusionReason })) };
}
async function context(db: Reader) {
  const tournament = await db.tournament.findUnique({ where: { id: "current" } });
  if (!tournament) throw new ScoringError("NOT_CONFIGURED", "赛事尚未配置", 409);
  const [rows, teams, approval] = await Promise.all([
    db.match.findMany({ include, orderBy: [{ courtId: "asc" }, { sequence: "asc" }] }), db.team.findMany(),
    db.approval.findFirst({ where: { type: "CROSS", invalidatedAt: null, sourceRevision: tournament.groupResultsRevision } }),
  ]);
  return { tournament, rows, teams, approval };
}
type Context = Awaited<ReturnType<typeof context>>;
function snapshot(row: Row, ctx: Context): StaffMatch {
  const state = stateOf(row);
  if (state.status === "NOT_STARTED" && ctx.approval && state.stage !== "GROUP") {
    const resolve = (ref: string, stored: string | null) => {
      if (!/^(winner|loser):/.test(ref)) return stored;
      const [kind, code] = ref.split(":");
      const source = ctx.rows.find((match) => match.code === code);
      return source?.status === "FINISHED" && source.submittedAt && source.winnerId
        ? kind === "winner" ? source.winnerId : source.winnerId === source.homeTeamId ? source.awayTeamId : source.homeTeamId : null;
    };
    state.homeTeamId = resolve(row.homeRef, state.homeTeamId); state.awayTeamId = resolve(row.awayRef, state.awayTeamId);
  }
  const participant = (ref: string, id: string | null) => {
    const team = ctx.teams.find((item) => item.id === id);
    return { ref, team: team ? { drawCode: team.drawCode, name: team.name } : null };
  };
  const semis = ctx.rows.filter((match) => match.stage === "SEMIFINAL").map((match) => ({ code: match.code, stage: match.stage })) as PublicMatch[];
  return { ...state, title: matchTitle({ stage: row.stage, code: row.code, group: row.group, placement: row.placement } as PublicMatch, semis),
    courtName: row.court.name, netHeightCm: row.court.netHeightCm, targetPoints: row.targetPoints, capPoints: row.capPoints,
    home: participant(row.homeRef, state.homeTeamId), away: participant(row.awayRef, state.awayTeamId),
    courtBusyMatchCode: state.status === "NOT_STARTED" ? ctx.rows.find((match) => match.courtId === row.courtId && match.id !== row.id && match.status === "LIVE")?.code ?? null : null,
    canStart: ctx.tournament.schedulePublished && state.status === "NOT_STARTED" && !!state.homeTeamId && !!state.awayTeamId && (row.stage === "GROUP" || !!ctx.approval),
    needsReview: row.stage !== "GROUP" && !ctx.approval && !!row.crossApprovalIdAtStart && !!row.startedAt };
}

export async function readScoringDesk(db: PrismaClient, principal: Principal) {
  return db.$transaction(async (tx) => {
    await assertPrincipal(tx, principal); const ctx = await context(tx);
    return { actor: principal, name: ctx.tournament.name, schedulePublished: ctx.tournament.schedulePublished,
      matches: ctx.rows.filter((row) => principal.role === "ADMIN" || row.courtId === principal.courtId).map((row) => snapshot(row, ctx)) };
  });
}
export async function readStaffMatch(db: PrismaClient, principal: Principal, code: string): Promise<StaffMatch> {
  return db.$transaction(async (tx) => {
    await assertPrincipal(tx, principal); const ctx = await context(tx); const row = ctx.rows.find((item) => item.code === code);
    if (!row) throw new ScoringError("NOT_FOUND", "未找到比赛", 404);
    assertCourt(principal, row.courtId); return snapshot(row, ctx);
  });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function performScoreAction(db: PrismaClient, principal: Principal, code: string, input: ScoreCommand): Promise<ScoreResponse> {
  const parsed = scoreCommandSchema.safeParse(input);
  if (!parsed.success) throw new ScoringError("INVALID_REQUEST", "请求格式不正确；比分应为非负整数，局号和版本须有效", 400);
  const command = parsed.data;
  const payload = canonical({ expectedVersion: command.expectedVersion, action: command.action });
  const apply = () => db.$transaction(async (tx) => {
    // The libSQL Prisma adapter starts DEFERRED transactions. Reserve the single event's
    // write transaction before reading, so competing readers do not deadlock on promotion.
    await tx.$executeRaw`UPDATE "Tournament" SET "revision" = "revision" WHERE "id" = 'current'`;
    await assertPrincipal(tx, principal); const ctx = await context(tx); const row = ctx.rows.find((match) => match.code === code);
    if (!row) throw new ScoringError("NOT_FOUND", "未找到比赛", 404);
    assertCourt(principal, row.courtId);
    const before = snapshot(row, ctx);
    const previous = await tx.scoreAction.findUnique({ where: { requestId: command.requestId } });
    if (previous) {
      if (previous.actor !== principal.id || previous.matchId !== row.id || previous.payload !== payload) throw new ScoringError("REQUEST_ID_REUSED", "请求编号已用于不同操作，请先核对记录", 409, before);
      // Return the current state, never replay an old response snapshot over newer results.
      return { receipt: { requestId: command.requestId, appliedVersion: previous.resultingVersion, replayed: true }, match: before };
    }
    if (row.version !== command.expectedVersion) throw new ScoringError("VERSION_CONFLICT", "服务器成绩已更新，请核对后采用最新版本", 409, before);
    if (!ctx.tournament.schedulePublished) throw new ScoringError("UNPUBLISHED", "赛程尚未发布，不能开始记分", 409, before);
    if (command.action.type === "START" && !before.canStart) throw new ScoringError("UNRESOLVED_MATCH", "对阵尚未正式确认或双方尚未确定", 409, before);
    if (command.action.type === "START" && before.courtBusyMatchCode) throw new ScoringError("COURT_BUSY", `${row.court.name}已有 ${before.courtBusyMatchCode} 比赛进行中，请先完成并提交该场，再开始本场。`, 409, before);
    if (row.stage !== "GROUP" && row.status !== "NOT_STARTED" && (!row.crossApprovalIdAtStart || !row.startedAt)) throw new ScoringError("UNCONFIRMED_START", "本场缺少正式开赛确认记录，请联系管理员核对", 409, before);
    const now = new Date();
    const after = reduceScore(before, command.action, principal.role, now.toISOString());
    if (command.action.type === "START" && row.stage !== "GROUP") after.crossApprovalIdAtStart = ctx.approval!.id;
    const updated = await tx.match.updateMany({ where: { id: row.id, version: command.expectedVersion }, data: {
      status: after.status, version: after.version, homeTeamId: after.homeTeamId, awayTeamId: after.awayTeamId, winnerId: after.winnerId,
      startedAt: after.startedAt ? new Date(after.startedAt) : null, submittedAt: after.submittedAt ? new Date(after.submittedAt) : null,
      crossApprovalIdAtStart: after.crossApprovalIdAtStart,
    } });
    if (updated.count !== 1) throw new ScoringError("VERSION_CONFLICT", "服务器成绩已更新，请核对最新版本", 409);
    for (const set of after.sets) await tx.setScore.upsert({ where: { matchId_setIndex: { matchId: row.id, setIndex: set.setIndex } },
      create: { matchId: row.id, ...set }, update: { ...set } });
    await tx.scoreAction.create({ data: { requestId: command.requestId, matchId: row.id, actor: principal.id, operation: command.action.type,
      payload, before: JSON.stringify(before), after: JSON.stringify(after), expectedVersion: command.expectedVersion, resultingVersion: after.version } });
    if (command.action.type !== "POINT") await tx.auditLog.create({ data: { actor: `${principal.role}:${principal.id}`, operation: command.action.type,
      subject: row.id, before: JSON.stringify(before), after: JSON.stringify(after) } });
    if (command.action.type === "START") await tx.tournament.updateMany({ where: { id: "current", startedAt: null }, data: { startedAt: now } });
    if (command.action.type === "SUBMIT_MATCH" || command.action.type === "CORRECT_RESULT") {
      await tx.tournament.update({ where: { id: "current" }, data: { resultsRevision: { increment: 1 }, ...(row.stage === "GROUP" ? { groupResultsRevision: { increment: 1 } } : {}) } });
      await tx.approval.updateMany({ where: { invalidatedAt: null, type: row.stage === "GROUP" ? { in: ["CROSS", "FINAL"] } : "FINAL" }, data: { invalidatedAt: now } });
    }
    const saved = await tx.match.findUniqueOrThrow({ where: { id: row.id }, include });
    const fresh = { ...ctx, rows: ctx.rows.map((match) => match.id === row.id ? saved : match) };
    return { receipt: { requestId: command.requestId, appliedVersion: after.version, replayed: false }, match: snapshot(saved, fresh) };
  }, { maxWait: 5000, timeout: 15000 });
  // Retry only transaction/unique races with the exact same id and expected version.
  for (let attempt = 0; ; attempt++) {
    try { return await apply(); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const meta = error && typeof error === "object" && "meta" in error ? error.meta : null;
      const rawBusy = code === "P2010" && (
        (!!meta && typeof meta === "object" && "code" in meta && ["5", "6", "SQLITE_BUSY", "SQLITE_LOCKED"].includes(String(meta.code))) ||
        (error instanceof Error && /SQLITE_BUSY|SQLITE_LOCKED/.test(error.message)));
      if (!(error instanceof ScoringError) && attempt < 2 && (rawBusy || ["P2002", "P2034", "P1008", "P2028", "SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT"].includes(code))) {
        await new Promise((resolve) => setTimeout(resolve, 25 + attempt * 25));
        continue;
      }
      throw error;
    }
  }
}
