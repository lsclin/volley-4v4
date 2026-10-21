import type { Prisma, PrismaClient } from "../../generated/four-v-four/index.js";
import { generateSchedule } from "./schedule.ts";
import { assertMode, COURTS, teamCodes } from "./types.ts";
import { calculateFinalStandings, calculateGroupStandings } from "./public-logic.ts";
import type { PublicMatch, PublicSchedule } from "./public-types.ts";
import { confirmedGroupOrder } from "./admin-logic.ts";

export type Database = PrismaClient | Prisma.TransactionClient;
export function inTransaction<T>(db: Database, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return "$transaction" in db ? db.$transaction(operation) : operation(db);
}

export const DEFAULT_RULES = "小组赛BO1：25分、领先2分、29分封顶；交叉赛BO3：三局均为15分、领先2分、19分封顶。场上始终至少1名女生。队员不得在本方三米线前区域完成高于球网上沿的进攻性击球；允许正常垫球、传球和不违反限制的非进攻性回球。发球轮换、自由人及临界判罚依正式章程说明，由现场裁判执行。";

export async function initializeTournament(db: Database, input: { mode: number; name?: string }, actor = "local-admin") {
  assertMode(input.mode);
  const mode = input.mode;
  const name = input.name?.trim() || "高新区继往开来排球赛";
  const schedule = generateSchedule(mode);
  return inTransaction(db, async (tx) => {
    if (await tx.tournament.findUnique({ where: { id: "current" } })) throw new Error("赛事已初始化，不能覆盖已有数据");
    const tournament = await tx.tournament.create({ data: { id: "current", mode, name, rulesText: DEFAULT_RULES } });
    await tx.credential.updateMany({ where: { role: "ADMIN", tournamentId: null }, data: { tournamentId: tournament.id } });
    await tx.court.createMany({ data: COURTS.map((court) => ({ ...court, tournamentId: tournament.id })) });
    await tx.team.createMany({ data: teamCodes(mode).map((drawCode) => ({ id: `team:${drawCode}`, tournamentId: tournament.id,
      drawCode, name: "", group: drawCode[0] as "A" | "B", slot: Number(drawCode.slice(1)) })) });
    await tx.match.createMany({ data: schedule.map((match) => ({ ...match, id: match.code, tournamentId: tournament.id,
      homeTeamId: match.stage === "GROUP" ? match.homeRef : null,
      awayTeamId: match.stage === "GROUP" ? match.awayRef : null })) });
    await tx.auditLog.create({ data: { actor, operation: "INITIALIZE", subject: "tournament", after: JSON.stringify({ mode, name, matchCount: schedule.length }) } });
    return tournament;
  });
}

// Called by trusted local CLI or the authenticated administrator transaction.
export async function updateTeamNames(db: Database, names: Record<string, string>, expectedRevision: number, actor = "local-admin") {
  if (!Object.keys(names).length) throw new Error("请提供队伍名称");
  return inTransaction(db, async (tx) => {
    const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: "current" } });
    const valid = new Set(teamCodes(tournament.mode as 8 | 10));
    for (const [code, name] of Object.entries(names)) {
      if (!valid.has(code) || typeof name !== "string" || !name.trim() || name.trim().length > 60) throw new Error("队伍编号或名称不正确");
    }
    const updated = await tx.tournament.updateMany({ where: { id: "current", revision: expectedRevision }, data: { revision: { increment: 1 } } });
    if (updated.count !== 1) throw new Error("数据版本已变化，请重新读取后再提交");
    const previous = await tx.team.findMany({ select: { drawCode: true, name: true } });
    for (const [drawCode, name] of Object.entries(names)) await tx.team.update({ where: { tournamentId_drawCode: { tournamentId: "current", drawCode } }, data: { name: name.trim() } });
    await tx.auditLog.create({ data: { actor, operation: "TEAM_NAMES", subject: "teams", before: JSON.stringify(previous), after: JSON.stringify(names) } });
    return expectedRevision + 1;
  });
}

export async function updateTournamentText(db: Database, input: { name?: string; rulesText?: string }, expectedRevision: number, actor = "local-admin") {
  const data: { name?: string; rulesText?: string } = {};
  if (input.name !== undefined) { if (!input.name.trim() || input.name.trim().length > 120) throw new Error("赛事名称不正确"); data.name = input.name.trim(); }
  if (input.rulesText !== undefined) { if (input.rulesText.length > 20000) throw new Error("规则文字过长"); data.rulesText = input.rulesText; }
  if (!Object.keys(data).length) throw new Error("没有可修改的字段");
  return inTransaction(db, async (tx) => {
    const previous = await tx.tournament.findUniqueOrThrow({ where: { id: "current" } });
    const updated = await tx.tournament.updateMany({ where: { id: "current", revision: expectedRevision }, data: { ...data, revision: { increment: 1 } } });
    if (updated.count !== 1) throw new Error("数据版本已变化，请重新读取后再提交");
    await tx.auditLog.create({ data: { actor, operation: "CONFIG_TEXT", subject: "tournament", before: JSON.stringify({ name: previous.name, rulesText: previous.rulesText }), after: JSON.stringify(data) } });
    return expectedRevision + 1;
  });
}

export async function publishSchedule(db: Database, expectedRevision: number, actor = "local-admin") {
  return inTransaction(db, async (tx) => {
    const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: "current" } });
    if (tournament.schedulePublished) throw new Error("小组赛赛程已经发布");
    const teams = await tx.team.findMany();
    if (teams.length !== tournament.mode || teams.some((team) => !team.name.trim())) throw new Error("请先完成全部队伍的抽签编号与队名登记");
    const updated = await tx.tournament.updateMany({ where: { id: "current", revision: expectedRevision }, data: { schedulePublished: true, revision: { increment: 1 } } });
    if (updated.count !== 1) throw new Error("数据版本已变化，请重新读取后再提交");
    await tx.auditLog.create({ data: { actor, operation: "PUBLISH_SCHEDULE", subject: "tournament", after: JSON.stringify({ revision: expectedRevision + 1 }) } });
    return expectedRevision + 1;
  });
}

export async function readAdminSetup(db: PrismaClient) {
  return db.tournament.findUnique({ where: { id: "current" }, include: {
    teams: { orderBy: { drawCode: "asc" } }, courts: true,
    matches: { orderBy: { code: "asc" }, include: { sets: { orderBy: { setIndex: "asc" } } } },
  } });
}

export async function readPublicSchedule(db: Database): Promise<PublicSchedule> {
  // Read a coherent publication snapshot; never serialize raw admin records.
  return inTransaction(db, async (tx) => {
    const tournament = await tx.tournament.findUnique({ where: { id: "current" } });
    if (!tournament) return { publication: "unconfigured" as const, teams: [], matches: [] };
    const info = { name: tournament.name, mode: tournament.mode, location: tournament.location,
      rulesText: tournament.rulesText, noticeText: tournament.noticeText };
    if (!tournament.schedulePublished) return { ...info, publication: "draft" as const, teams: [], matches: [] };
    const [teams, courts, matches, cross, priorCross, final] = await Promise.all([
      tx.team.findMany({ orderBy: { drawCode: "asc" } }), tx.court.findMany(),
      tx.match.findMany({ orderBy: [{ courtId: "asc" }, { sequence: "asc" }], include: { sets: { orderBy: { setIndex: "asc" } } } }),
      tx.approval.findFirst({ where: { type: "CROSS", invalidatedAt: null, sourceRevision: tournament.groupResultsRevision }, orderBy: { approvedAt: "desc" } }),
      tx.approval.findFirst({ where: { type: "CROSS" }, orderBy: { approvedAt: "desc" } }),
      tx.approval.findFirst({ where: { type: "FINAL", invalidatedAt: null, sourceRevision: tournament.resultsRevision } }),
    ]);
    const participant = (ref: string, teamId: string | null, disclose: boolean) => {
      const team = disclose ? teams.find((item) => item.id === teamId) : undefined;
      return team ? { ref, team: { drawCode: team.drawCode, name: team.name } } : { ref, team: null };
    };
    const publicTeams = teams.map(({ drawCode, name, group }) => ({ drawCode, name, group }));
    const resolveParticipant = (ref: string, stored: string | null, disclose: boolean, status: string) => {
      let teamId = stored;
      // Resolve known semifinal outcomes for an unstarted final, never overwrite a match that already began.
      if (cross && status === "NOT_STARTED" && /^(winner|loser):/.test(ref)) {
        const [kind, code] = ref.split(":");
        const source = matches.find((m) => m.code === code && m.stage === "SEMIFINAL");
        if (source?.status === "FINISHED" && source.submittedAt && source.winnerId) {
          teamId = kind === "winner" ? source.winnerId : source.winnerId === source.homeTeamId ? source.awayTeamId : source.homeTeamId;
        }
      }
      return participant(ref, teamId, disclose);
    };
    const publicMatches: PublicMatch[] = matches.map((match) => {
      const startedWithConfirmation = !!match.crossApprovalIdAtStart && !!match.startedAt && match.status !== "NOT_STARTED";
      const disclose = match.stage === "GROUP" || !!cross || startedWithConfirmation;
      return { code: match.code, stage: match.stage, group: match.group, placement: match.placement,
        courtId: match.courtId, sequence: match.sequence, format: match.format, targetPoints: match.targetPoints, capPoints: match.capPoints,
        status: disclose ? match.status : "NOT_STARTED", home: resolveParticipant(match.homeRef, match.homeTeamId, disclose, match.status),
        away: resolveParticipant(match.awayRef, match.awayTeamId, disclose, match.status),
        sets: disclose && match.status !== "NOT_STARTED" ? match.sets.map(({ setIndex, homePoints, awayPoints, confirmed, excluded }) => ({ setIndex, homePoints, awayPoints, confirmed, excluded })) : [],
        winner: disclose && match.status === "FINISHED" ? teams.find((team) => team.id === match.winnerId)?.drawCode ?? null : null,
        submittedAt: disclose ? match.submittedAt?.toISOString() ?? null : null,
        needsReview: match.stage !== "GROUP" && !cross && startedWithConfirmation };
    });
    const derivedFinal = calculateFinalStandings(publicTeams, publicMatches);
    let finalPublished = false;
    if (final && cross && derivedFinal.length === tournament.mode) {
      try {
        const snapshot: unknown = JSON.parse(final.snapshot);
        const rows = typeof snapshot === "object" && snapshot !== null && "rankings" in snapshot ? snapshot.rankings : null;
        finalPublished = Array.isArray(rows) && rows.length === derivedFinal.length && derivedFinal.every((entry) =>
          rows.some((row: unknown) => typeof row === "object" && row !== null && "rank" in row && "drawCode" in row && row.rank === entry.rank && row.drawCode === entry.drawCode));
      } catch { /* An invalid or incompatible snapshot never publishes a final table. */ }
    }
    const groups = ["A", "B"].map((group) => calculateGroupStandings(publicTeams, publicMatches, group as "A" | "B"));
    return { ...info, publication: "published" as const, crossPublished: !!cross, crossNeedsReview: !cross && !!priorCross,
      finalPublished, finalStandings: finalPublished ? derivedFinal : [],
      allFinished: publicMatches.every((match) => match.status === "FINISHED" && !!match.submittedAt),
      teams: publicTeams,
      courts: courts.map(({ id, name, netHeightCm }) => ({ id, name, netHeightCm })),
      matches: publicMatches, groups: cross ? confirmedGroupOrder(groups, cross.snapshot) : groups,
    };
  });
}
