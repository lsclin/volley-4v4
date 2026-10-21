import { assertMode, teamCodes } from "./types.ts";
import type { CourtId, GroupCode, ParticipantRef, ScheduledMatch, TournamentMode } from "./types.ts";

// Each row is two independent court queues, never a simultaneous-start round.
const TEMPLATES = {
  8: [
    ["A1-A2", "B1-B3"], ["A3-A4", "B2-B4"],
    ["B1-B2", "A1-A3"], ["B3-B4", "A2-A4"],
    ["B2-B3", "A1-A4"], ["A2-A3", "B1-B4"],
  ],
  10: [
    ["A1-A2", "B1-B3"], ["A3-A4", "B2-B4"],
    ["A1-A5", "B3-B5"], ["B1-B2", "A2-A4"],
    ["B4-B5", "A3-A5"], ["B2-B3", "A1-A4"],
    ["A2-A3", "B1-B4"], ["A4-A5", "B2-B5"],
    ["B3-B4", "A1-A3"], ["B1-B5", "A2-A5"],
  ],
} as const;

export function generateSchedule(mode: TournamentMode): ScheduledMatch[] {
  assertMode(mode);
  const matches: ScheduledMatch[] = [];
  const template = TEMPLATES[mode];
  const nextCode = () => `M${String(matches.length + 1).padStart(2, "0")}`;
  for (const [rowIndex, row] of template.entries()) {
    for (const [column, pair] of row.entries()) {
      const [home, away] = pair.split("-");
      matches.push({ code: nextCode(), stage: "GROUP", group: home[0] as GroupCode,
        placement: null, format: "BO1", targetPoints: 25, capPoints: 29,
        courtId: column === 0 ? "main" : "secondary", sequence: rowIndex + 1,
        homeRef: `team:${home}` as ParticipantRef, awayRef: `team:${away}` as ParticipantRef });
    }
  }
  const firstCross = matches.length + 1;
  const semi1 = `M${firstCross}`;
  const semi2 = `M${firstCross + 1}`;
  const mainBase = template.length;
  const placementCount = mode === 8 ? 2 : 3;
  const mainPlacementCount = mode === 8 ? 1 : 2;
  const addCross = (stage: ScheduledMatch["stage"], homeRef: ParticipantRef, awayRef: ParticipantRef,
    courtId: CourtId, sequence: number, placement: number | null = null) => {
    matches.push({ code: nextCode(), stage, group: null, placement, format: "BO3",
      targetPoints: 15, capPoints: 19, courtId, sequence, homeRef, awayRef });
  };
  addCross("SEMIFINAL", "rank:A:1", "rank:B:2", "main", mainBase + mainPlacementCount + 1);
  addCross("SEMIFINAL", "rank:B:1", "rank:A:2", "main", mainBase + mainPlacementCount + 2);
  for (let i = 0; i < placementCount; i++) {
    const rank = i + 3;
    addCross("PLACEMENT", `rank:A:${rank}`, `rank:B:${rank}`, i === 1 ? "secondary" : "main",
      mainBase + (i === 2 ? 2 : 1), 2 * rank - 1);
  }
  addCross("THIRD_PLACE", `loser:${semi1}` as ParticipantRef, `loser:${semi2}` as ParticipantRef,
    "main", mainBase + mainPlacementCount + 3);
  addCross("FINAL", `winner:${semi1}` as ParticipantRef, `winner:${semi2}` as ParticipantRef,
    "main", mainBase + mainPlacementCount + 4);
  validateGeneratedSchedule(mode, matches);
  return matches;
}

export function validateGeneratedSchedule(mode: TournamentMode, matches: readonly ScheduledMatch[]): void {
  assertMode(mode);
  const groupSize = mode / 2;
  const codes = teamCodes(mode);
  const groupCount = groupSize * (groupSize - 1);
  const total = mode === 8 ? 18 : 27;
  if (matches.length !== total || new Set(matches.map((m) => m.code)).size !== total) throw new Error("比赛数量或编号不正确");
  if (matches.some((m) => !["main", "secondary"].includes(m.courtId) || !Number.isSafeInteger(m.sequence) || m.sequence < 1)) throw new Error("场地或队列序号不正确");
  const groupMatches = matches.filter((m) => m.stage === "GROUP");
  if (groupMatches.length !== groupCount) throw new Error("小组赛数量不正确");
  const pairs = new Set<string>();
  const counts = new Map(codes.map((code) => [code, { main: 0, secondary: 0 }]));
  for (const match of groupMatches) {
    const home = match.homeRef.replace(/^team:/, "");
    const away = match.awayRef.replace(/^team:/, "");
    if (!match.homeRef.startsWith("team:") || !match.awayRef.startsWith("team:") ||
      !counts.has(home) || !counts.has(away) || home === away || home[0] !== away[0] || match.group !== home[0]) throw new Error("小组对阵引用不正确");
    const key = [home, away].sort().join("-");
    if (pairs.has(key)) throw new Error("小组赛存在重复对阵");
    pairs.add(key);
    if (match.format !== "BO1" || match.targetPoints !== 25 || match.capPoints !== 29) throw new Error("小组赛赛制不正确");
    if (match.courtId !== "main" && match.courtId !== "secondary") throw new Error("未知场地");
    counts.get(home)![match.courtId]++;
    counts.get(away)![match.courtId]++;
  }
  for (const code of codes) {
    for (const opponent of codes.filter((other) => other[0] === code[0] && other !== code)) {
      if (!pairs.has([code, opponent].sort().join("-"))) throw new Error("小组赛漏掉对手");
    }
    const count = counts.get(code)!;
    if (mode === 10 ? count.main !== 2 || count.secondary !== 2 :
      count.main + count.secondary !== 3 || Math.min(count.main, count.secondary) !== 1 || Math.max(count.main, count.secondary) !== 2) throw new Error("赛前网高分配不均衡");
  }
  for (const court of ["main", "secondary"] as const) {
    const queue = matches.filter((m) => m.courtId === court).sort((a, b) => a.sequence - b.sequence);
    if (queue.some((m, i) => m.sequence !== i + 1)) throw new Error("场地队列序号不连续或重复");
  }
  const cross = matches.filter((m) => m.stage !== "GROUP");
  if (cross.some((m) => m.format !== "BO3" || m.targetPoints !== 15 || m.capPoints !== 19)) throw new Error("交叉赛赛制不正确");
  const semis = cross.filter((m) => m.stage === "SEMIFINAL");
  if (semis.length !== 2 || semis[0].homeRef !== "rank:A:1" || semis[0].awayRef !== "rank:B:2" ||
    semis[1].homeRef !== "rank:B:1" || semis[1].awayRef !== "rank:A:2") throw new Error("半决赛对阵不正确");
  const finals = cross.filter((m) => m.stage === "FINAL");
  const third = cross.filter((m) => m.stage === "THIRD_PLACE");
  if (finals.length !== 1 || third.length !== 1 || finals[0].homeRef !== `winner:${semis[0].code}` ||
    finals[0].awayRef !== `winner:${semis[1].code}` || third[0].homeRef !== `loser:${semis[0].code}` ||
    third[0].awayRef !== `loser:${semis[1].code}`) throw new Error("冠亚军或季军来源不正确");
  const placements = cross.filter((m) => m.stage === "PLACEMENT");
  if (placements.length !== groupSize - 2 || placements.some((m, i) =>
    m.homeRef !== `rank:A:${i + 3}` || m.awayRef !== `rank:B:${i + 3}` || m.placement !== (i + 3) * 2 - 1)) throw new Error("排位赛对阵不正确");
  const four = [...semis, third[0], finals[0]];
  if (four.some((m) => m.courtId !== "main") || four.some((m, i) => i > 0 && m.sequence <= four[i - 1].sequence) ||
    placements.filter((m) => m.courtId === "main").some((m) => m.sequence >= semis[0].sequence)) throw new Error("四强主场地顺序不正确");
}
