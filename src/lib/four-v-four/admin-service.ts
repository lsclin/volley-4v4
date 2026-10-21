import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/four-v-four/index.js";
import { hashAccessCode, verifyAccessCode } from "./credentials.ts";
import { inTransaction, initializeTournament, publishSchedule, updateTeamNames, updateTournamentText } from "./repository.ts";
import { calculateFinalStandings, calculateGroupStandings } from "./public-logic.ts";
import { assertPrincipal } from "./scoring-service.ts";
import { ScoringError } from "./scoring-types.ts";
import type { Principal } from "./scoring-types.ts";
import type { AdminMatch, AdminSnapshot } from "./admin-types.ts";
import { confirmedGroupOrder, downstreamDiscrepancies, previewCross } from "./admin-logic.ts";
import { ACCESS_CODE_MIN_LENGTH, ACCESS_CODE_MAX_LENGTH } from "./access-code-policy.ts";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("INITIALIZE"), mode: z.union([z.literal(8), z.literal(10)]), name: z.string().trim().min(1).max(120) }).strict(),
  z.object({ type: z.literal("TEAMS"), names: z.record(z.string(), z.string().trim().min(1).max(60)) }).strict(),
  z.object({ type: z.literal("CONFIG"), name: z.string().trim().min(1).max(120), location: z.string().trim().max(200), rulesText: z.string().max(20000), noticeText: z.string().trim().max(500) }).strict(),
  z.object({ type: z.literal("PUBLISH_SCHEDULE") }).strict(),
  z.object({ type: z.literal("MOVE_MATCH"), code: z.string().regex(/^M\d+$/), expectedVersion: integer, courtId: z.enum(["main", "secondary"]), sequence: integer.min(1).max(100) }).strict(),
  z.object({ type: z.literal("CONFIRM_CROSS"), sourceRevision: integer, tieBreaks: z.record(z.string(), z.array(z.string()).max(5)), reason: z.string().trim().max(500), acknowledgePlayed: z.boolean() }).strict(),
  z.object({ type: z.literal("CONFIRM_FINAL"), sourceRevision: integer, acknowledgePlayed: z.boolean() }).strict(),
  z.object({ type: z.literal("SET_SCORER_PASSWORD"), target: z.enum(["main", "secondary"]), password: z.string().trim().min(ACCESS_CODE_MIN_LENGTH).max(ACCESS_CODE_MAX_LENGTH), expectedCredentialVersion: integer.nullable() }).strict(),
]);
export const adminCommandSchema = z.object({ expectedRevision: integer.nullable(), action: actionSchema }).strict();
export type AdminCommand = z.infer<typeof adminCommandSchema>;

async function assertAdmin(tx: Prisma.TransactionClient, principal: Principal) {
  await assertPrincipal(tx, principal);
  if (principal.role !== "ADMIN") throw new ScoringError("FORBIDDEN", "只有管理员可以管理赛事", 403);
}

async function snapshot(tx: Prisma.TransactionClient): Promise<AdminSnapshot> {
  const tournament = await tx.tournament.findUnique({ where: { id: "current" } });
  const credentials = await tx.credential.findMany({ select: { role: true, courtId: true, version: true } });
  const credentialStatus = (["admin", "main", "secondary"] as const).map((target) => {
    const credential = credentials.find((row) => target === "admin" ? row.role === "ADMIN" : row.courtId === target);
    return { target, configured: !!credential, version: credential?.version ?? null };
  });
  const empty: AdminSnapshot = { tournament: null, teams: [], courts: [], matches: [], groups: [], cross: { valid: false, previouslyConfirmed: false }, final: { valid: false, previouslyConfirmed: false, rankings: [], needsReview: [] }, credentials: credentialStatus };
  if (!tournament) return empty;
  const [teams, courts, rows, approvals] = await Promise.all([
    tx.team.findMany({ orderBy: { drawCode: "asc" } }), tx.court.findMany(),
    tx.match.findMany({ include: { sets: { orderBy: { setIndex: "asc" } } }, orderBy: [{ courtId: "asc" }, { sequence: "asc" }] }),
    tx.approval.findMany({ orderBy: { approvedAt: "desc" } }),
  ]);
  const participant = (ref: string, id: string | null) => {
    const team = teams.find((row) => row.id === id);
    return { ref, team: team ? { drawCode: team.drawCode, name: team.name } : null };
  };
  const matches: AdminMatch[] = rows.map((row) => ({ code: row.code, stage: row.stage, group: row.group, placement: row.placement, format: row.format,
    courtId: row.courtId, sequence: row.sequence, targetPoints: row.targetPoints, capPoints: row.capPoints, status: row.status, version: row.version,
    home: participant(row.homeRef, row.homeTeamId), away: participant(row.awayRef, row.awayTeamId), sets: row.sets.map(({ setIndex, homePoints, awayPoints, confirmed, excluded }) => ({ setIndex, homePoints, awayPoints, confirmed, excluded })),
    winner: teams.find((team) => team.id === row.winnerId)?.drawCode ?? null, startedAt: row.startedAt?.toISOString() ?? null, submittedAt: row.submittedAt?.toISOString() ?? null, needsReview: false }));
  // Resolve only unstarted semifinal-dependent matches; actual participants of played matches are immutable here.
  for (const match of matches.filter((row) => row.status === "NOT_STARTED")) for (const side of ["home", "away"] as const) {
    const ref = /^(winner|loser):(M\d+)$/.exec(match[side].ref);
    if (!ref) continue;
    const source = matches.find((row) => row.code === ref[2]);
    const code = source?.status === "FINISHED" && source.submittedAt && source.winner ? ref[1] === "winner" ? source.winner : source.winner === source.home.team?.drawCode ? source.away.team?.drawCode : source.home.team?.drawCode : null;
    match[side] = participant(match[side].ref, code ? `team:${code}` : null);
  }
  const publicTeams = teams.map(({ drawCode, name, group }) => ({ drawCode, name, group }));
  const cross = approvals.find((row) => row.type === "CROSS" && !row.invalidatedAt && row.sourceRevision === tournament.groupResultsRevision);
  const final = approvals.find((row) => row.type === "FINAL" && !row.invalidatedAt && row.sourceRevision === tournament.resultsRevision);
  for (const match of matches) match.needsReview = match.stage !== "GROUP" && !cross && !!match.startedAt && match.status !== "NOT_STARTED";
  const groups = (["A", "B"] as const).map((group) => calculateGroupStandings(publicTeams, matches, group));
  return { tournament: { name: tournament.name, mode: tournament.mode, location: tournament.location, rulesText: tournament.rulesText, noticeText: tournament.noticeText,
    revision: tournament.revision, groupResultsRevision: tournament.groupResultsRevision, resultsRevision: tournament.resultsRevision, schedulePublished: tournament.schedulePublished, startedAt: tournament.startedAt?.toISOString() ?? null },
    teams: publicTeams, courts: courts.map(({ id, name, netHeightCm }) => ({ id, name, netHeightCm })), matches,
    groups: cross ? confirmedGroupOrder(groups, cross.snapshot) : groups,
    cross: { valid: !!cross, previouslyConfirmed: approvals.some((row) => row.type === "CROSS") },
    final: { valid: !!final && !!cross, previouslyConfirmed: approvals.some((row) => row.type === "FINAL"), rankings: calculateFinalStandings(publicTeams, matches), needsReview: downstreamDiscrepancies(matches) }, credentials: credentialStatus };
}

export async function readAdminTournament(db: PrismaClient, principal: Principal) {
  return db.$transaction(async (tx) => { await assertAdmin(tx, principal); return snapshot(tx); });
}

export async function performAdminAction(db: PrismaClient, principal: Principal, input: unknown) {
  const parsed = adminCommandSchema.safeParse(input);
  if (!parsed.success) throw new ScoringError("INVALID_REQUEST", "管理请求格式不正确，请核对输入", 400);
  const { expectedRevision, action } = parsed.data;
  // Hash before acquiring the writer; never return or log the supplied password.
  const codeHash = action.type === "SET_SCORER_PASSWORD" ? await hashAccessCode(action.password) : undefined;
  const apply = () => inTransaction(db, async (tx) => {
    // Serialize against scoring, schedule edits, credential resets and other administrators.
    await tx.$executeRaw`UPDATE "Credential" SET "version" = "version" WHERE "id" = ${principal.id}`;
    await assertAdmin(tx, principal);
    const before = await snapshot(tx); const tournament = before.tournament;
    const actor = `ADMIN:${principal.id}`;
    if (action.type === "INITIALIZE") {
      if (tournament || expectedRevision !== null) throw new ScoringError("ALREADY_CONFIGURED", "赛事已初始化，不能覆盖已有数据", 409);
      await initializeTournament(tx, action, actor);
      return { data: await snapshot(tx) };
    }
    if (!tournament) throw new ScoringError("NOT_CONFIGURED", "请先初始化赛事", 409);
    if (expectedRevision !== tournament.revision) throw new ScoringError("VERSION_CONFLICT", "赛事配置已变化，请刷新并核对后重新操作", 409);
    if (action.type === "TEAMS") {
      if (!Object.keys(action.names).length || Object.keys(action.names).some((code) => !before.teams.some((team) => team.drawCode === code))) throw new ScoringError("INVALID_TEAM", "只能修改本赛事固定抽签编号对应的队名");
      await updateTeamNames(tx, action.names, tournament.revision, actor);
    }
    else if (action.type === "PUBLISH_SCHEDULE") {
      if (tournament.schedulePublished) throw new ScoringError("ALREADY_PUBLISHED", "正式小组赛程已经发布", 409);
      if (before.teams.some((team) => !team.name.trim())) throw new ScoringError("INCOMPLETE_TEAMS", "请先完成全部抽签编号与队名登记");
      await publishSchedule(tx, tournament.revision, actor);
    } else {
      if (action.type === "CONFIG") {
        await updateTournamentText(tx, action, tournament.revision, actor);
        await tx.tournament.update({ where: { id: "current" }, data: { location: action.location, noticeText: action.noticeText || null } });
      } else if (action.type === "MOVE_MATCH") {
        const match = before.matches.find((row) => row.code === action.code);
        if (!match) throw new ScoringError("NOT_FOUND", "未找到比赛", 404);
        if (match.status !== "NOT_STARTED" || match.startedAt) throw new ScoringError("MATCH_LOCKED", "已开始或已结束比赛不能调整场地与顺序", 409);
        if (match.version !== action.expectedVersion) throw new ScoringError("VERSION_CONFLICT", "比赛已变化，请刷新后核对", 409);
        // Insert among destination-court unstarted slots. Started/finished slots never move.
        const destination = before.matches.filter((row) => row.courtId === action.courtId && row.code !== match.code).sort((a, b) => a.sequence - b.sequence);
        const locked = new Set(destination.filter((row) => row.status !== "NOT_STARTED" || row.startedAt).map((row) => row.sequence));
        if (locked.has(action.sequence)) throw new ScoringError("SLOT_LOCKED", "此顺序属于已开始或已结束比赛，请选择其他位置", 409);
        const queue = destination.filter((row) => row.status === "NOT_STARTED" && !row.startedAt);
        const index = queue.findIndex((row) => row.sequence >= action.sequence);
        queue.splice(index < 0 ? queue.length : index, 0, match);
        const plan: { code: string; sequence: number }[] = [];
        let sequence = 1;
        for (const row of queue) {
          if (row.code === match.code) sequence = Math.max(sequence, action.sequence);
          while (locked.has(sequence)) sequence++;
          plan.push({ code: row.code, sequence: sequence++ });
        }
        // Free unique slots with positive temporary values, then assign the final queue atomically.
        for (const [i, row] of plan.entries()) await tx.match.update({ where: { id: row.code }, data: { sequence: 1000 + i } });
        for (const row of plan) await tx.match.update({ where: { id: row.code }, data: { courtId: action.courtId, sequence: row.sequence, version: { increment: 1 } } });
      } else if (action.type === "CONFIRM_CROSS") {
        if (!tournament.schedulePublished || !before.groups.every((group) => group.complete)) throw new ScoringError("GROUPS_INCOMPLETE", "全部小组赛提交完成后才能确认交叉赛", 409);
        if (action.sourceRevision !== tournament.groupResultsRevision) throw new ScoringError("VERSION_CONFLICT", "小组成绩已变化，请重新核对排名及对阵", 409);
        if (before.cross.valid) throw new ScoringError("ALREADY_PUBLISHED", "当前交叉赛对阵已经确认", 409);
        const preview = previewCross(before.groups, before.matches, action.tieBreaks);
        if (preview.unresolved.length) throw new ScoringError("TIE_BREAK_REQUIRED", "请先裁定完全并列队伍的先后顺序");
        if (Object.keys(action.tieBreaks).length && !action.reason) throw new ScoringError("TIE_BREAK_REQUIRED", "请填写按赛前补充规则裁定的依据");
        if (preview.matches.some((row) => row.differs) && !action.acknowledgePlayed) throw new ScoringError("REVIEW_REQUIRED", "已有比赛实际对阵与新排名不同，请核对并确认保留实际对阵");
        for (const row of preview.matches.filter((row) => !row.frozen)) {
          const match = before.matches.find((item) => item.code === row.code)!;
          // Final/third-place teams remain semifinal-derived, not predicted from group ranks.
          await tx.match.update({ where: { id: row.code }, data: {
            homeTeamId: row.home ? `team:${row.home}` : match.home.team ? `team:${match.home.team.drawCode}` : null,
            awayTeamId: row.away ? `team:${row.away}` : match.away.team ? `team:${match.away.team.drawCode}` : null,
            version: { increment: 1 },
          } });
        }
        await tx.approval.create({ data: { type: "CROSS", sourceRevision: tournament.groupResultsRevision, snapshot: JSON.stringify({ ...preview, tieBreaks: action.tieBreaks, reason: action.reason, acknowledgePlayed: action.acknowledgePlayed }), approvedBy: actor } });
      } else if (action.type === "CONFIRM_FINAL") {
        if (action.sourceRevision !== tournament.resultsRevision) throw new ScoringError("VERSION_CONFLICT", "正式成绩已变化，请重新核对最终名次", 409);
        if (before.final.valid) throw new ScoringError("ALREADY_PUBLISHED", "当前最终名次已经公布", 409);
        if (!before.cross.valid || before.final.rankings.length !== tournament.mode) throw new ScoringError("RESULTS_INCOMPLETE", "请先确认交叉赛，并完成全部正式比赛；名次必须完整且无重复", 409);
        if (before.final.needsReview.length && !action.acknowledgePlayed) throw new ScoringError("REVIEW_REQUIRED", "半决赛修正影响已开打场次，请核对并确认保留实际对阵");
        await tx.approval.create({ data: { type: "FINAL", sourceRevision: tournament.resultsRevision, snapshot: JSON.stringify({ rankings: before.final.rankings.map(({ rank, drawCode }) => ({ rank, drawCode })), acknowledgePlayed: action.acknowledgePlayed }), approvedBy: actor } });
      } else if (action.type === "SET_SCORER_PASSWORD") {
        const credentials = await tx.credential.findMany();
        const credential = credentials.find((row) => row.role === "SCORER" && row.courtId === action.target);
        if ((credential?.version ?? null) !== action.expectedCredentialVersion) throw new ScoringError("VERSION_CONFLICT", "记分员密码已变化，请刷新并核对后再修改", 409);
        const duplicates = await Promise.all(credentials.filter((row) => row.id !== credential?.id).map((row) => verifyAccessCode(action.password, row.codeHash)));
        if (duplicates.some(Boolean)) throw new ScoringError("DUPLICATE_CODE", "不能与管理员或另一名记分员使用相同密码");
        if (credential) await tx.credential.update({ where: { id: credential.id }, data: { codeHash, version: { increment: 1 } } });
        else await tx.credential.create({ data: { role: "SCORER", courtId: action.target, codeHash: codeHash! } });
      }
      if (action.type !== "CONFIG") await tx.tournament.update({ where: { id: "current" }, data: { revision: { increment: 1 } } });
      await tx.auditLog.create({ data: { actor, operation: action.type, subject: action.type === "MOVE_MATCH" ? action.code : "tournament",
        before: JSON.stringify(action.type === "MOVE_MATCH" ? before.matches.filter((row) => row.courtId === action.courtId || row.code === action.code).map(({ code, courtId, sequence, status, version }) => ({ code, courtId, sequence, status, version })) : { revision: tournament.revision, groupResultsRevision: tournament.groupResultsRevision, resultsRevision: tournament.resultsRevision, ...(action.type === "CONFIG" ? { name: tournament.name, location: tournament.location, rulesText: tournament.rulesText, noticeText: tournament.noticeText } : {}) }),
        after: JSON.stringify(action.type === "SET_SCORER_PASSWORD" ? { type: action.type, target: action.target, expectedCredentialVersion: action.expectedCredentialVersion } : action) } });
    }
    return { data: await snapshot(tx) };
  });
  for (let attempt = 0; ; attempt++) {
    try { return await apply(); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const busy = error instanceof Error && /SQLITE_BUSY|SQLITE_LOCKED/.test(error.message);
      if (!(error instanceof ScoringError) && attempt < 2 && (busy || ["P2002", "P2034", "P1008", "P2028"].includes(code))) {
        await new Promise((resolve) => setTimeout(resolve, 25 + attempt * 25));
        continue;
      }
      throw error;
    }
  }
}
