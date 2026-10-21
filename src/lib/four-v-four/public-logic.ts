import type { FinalStanding, GroupStanding, PublicMatch, PublicParticipant, PublicSet, PublicTeam, StandingRow } from "./public-types.ts";
import type { GroupCode } from "./types.ts";

export function participantLabel(participant: PublicParticipant, matches: readonly PublicMatch[] = []): string {
  if (participant.team) return `${participant.team.drawCode} ${participant.team.name}`;
  const rank = /^rank:([AB]):(\d+)$/.exec(participant.ref);
  if (rank) return `${rank[1]}组第${rank[2]}名`;
  const result = /^(winner|loser):(M\d+)$/.exec(participant.ref);
  if (result) {
    const semis = matches.filter((m) => m.stage === "SEMIFINAL").sort((a, b) => a.code.localeCompare(b.code));
    const index = semis.findIndex((m) => m.code === result[2]);
    return `${index >= 0 ? `半决赛${index + 1}` : result[2]}${result[1] === "winner" ? "胜者" : "负者"}`;
  }
  return participant.ref.replace(/^team:/, "") || "对阵待公布";
}

export function matchTitle(match: PublicMatch, matches: readonly PublicMatch[] = []): string {
  if (match.stage === "GROUP") return `${match.group}组 · 小组赛`;
  if (match.stage === "FINAL") return "冠亚军决赛";
  if (match.stage === "THIRD_PLACE") return "季军赛";
  if (match.stage === "PLACEMENT") return `第 ${match.placement} / ${(match.placement ?? 0) + 1} 名排位赛`;
  const index = matches.filter((m) => m.stage === "SEMIFINAL").sort((a, b) => a.code.localeCompare(b.code)).findIndex((m) => m.code === match.code);
  return `半决赛 ${index + 1}`;
}

// No threshold-based set completion: only explicit confirmations count as sets won.
export function scoreView(match: Pick<PublicMatch, "sets" | "status" | "format">) {
  let home = 0, away = 0;
  const included: PublicSet[] = [];
  for (const set of [...match.sets].sort((a, b) => a.setIndex - b.setIndex)) {
    if (set.excluded || !set.confirmed || (match.format === "BO3" && (home === 2 || away === 2))) continue;
    included.push(set);
    if (set.homePoints > set.awayPoints) home++;
    if (set.awayPoints > set.homePoints) away++;
  }
  const active = match.sets.find((set) => !set.confirmed && !set.excluded);
  const nextIndex = included.length + 1;
  const current = match.status !== "LIVE" || (match.format === "BO3" && (home >= 2 || away >= 2)) ? null : active ??
    ((match.format === "BO1" ? included.length === 0 : home < 2 && away < 2 && nextIndex <= 3)
      ? { setIndex: nextIndex, homePoints: 0, awayPoints: 0, confirmed: false, excluded: false } : null);
  const single = match.sets.find((set) => !set.excluded && set.setIndex === 1);
  return { home, away, current, included,
    primary: match.status === "NOT_STARTED" ? "VS" : match.format === "BO3" ? `${home} : ${away}` : `${single?.homePoints ?? 0} : ${single?.awayPoints ?? 0}` };
}

export function courtBoard(matches: readonly PublicMatch[], courtId: string) {
  const queue = matches.filter((match) => match.courtId === courtId).sort((a, b) => a.sequence - b.sequence);
  const current = queue.find((match) => match.status === "LIVE") ?? null;
  // Actual submission order, rather than the template row or the other court's progress.
  const previous = queue.filter((match) => match.status === "FINISHED" && match.submittedAt)
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "") || b.sequence - a.sequence)[0] ?? null;
  const next = queue.find((match) => match.status === "NOT_STARTED") ?? null;
  return { current, previous, next, primary: current ?? previous ?? next,
    complete: queue.length > 0 && queue.every((match) => match.status === "FINISHED") };
}

export function determinedTeamMatches(matches: readonly PublicMatch[], drawCode: string) {
  return matches.filter((match) => !!match.home.team && !!match.away.team &&
    [match.home.team.drawCode, match.away.team.drawCode].includes(drawCode))
    .sort((a, b) => Number(a.stage !== "GROUP") - Number(b.stage !== "GROUP") ||
      (a.stage === "GROUP" ? a.code.localeCompare(b.code) : a.sequence - b.sequence || a.code.localeCompare(b.code)));
}

function finishedGroup(match: PublicMatch) {
  return match.stage === "GROUP" && match.status === "FINISHED" && !!match.submittedAt && !!match.winner
    && !!match.home.team && !!match.away.team && match.sets.some((s) => s.confirmed && !s.excluded && s.homePoints !== s.awayPoints);
}

export function calculateGroupStandings(teams: readonly PublicTeam[], matches: readonly PublicMatch[], group: GroupCode): GroupStanding {
  const members = teams.filter((team) => team.group === group);
  const games = matches.filter((match) => match.group === group && finishedGroup(match));
  const rows: StandingRow[] = members.map((team) => ({ ...team, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, difference: 0, rank: 0, tied: false }));
  for (const row of rows) {
    for (const match of games) {
      const isHome = match.home.team!.drawCode === row.drawCode;
      if (!isHome && match.away.team!.drawCode !== row.drawCode) continue;
      const set = match.sets.find((s) => s.confirmed && !s.excluded)!;
      row.played++; row.wins += Number(match.winner === row.drawCode); row.losses += Number(match.winner !== row.drawCode);
      row.pointsFor += isHome ? set.homePoints : set.awayPoints; row.pointsAgainst += isHome ? set.awayPoints : set.homePoints;
    }
    row.difference = row.pointsFor - row.pointsAgainst;
  }
  const ordered: { row: StandingRow; key: number[] }[] = [];
  for (const wins of [...new Set(rows.map((row) => row.wins))].sort((a, b) => b - a)) {
    const tied = rows.filter((row) => row.wins === wins);
    const codes = new Set(tied.map((row) => row.drawCode));
    const mini = games.filter((m) => codes.has(m.home.team!.drawCode) && codes.has(m.away.team!.drawCode));
    const bucket = tied.map((row) => {
      let miniWins = 0, miniDiff = 0;
      for (const match of mini) {
        const isHome = match.home.team!.drawCode === row.drawCode;
        if (!isHome && match.away.team!.drawCode !== row.drawCode) continue;
        const set = match.sets.find((s) => s.confirmed && !s.excluded)!;
        miniWins += Number(match.winner === row.drawCode);
        miniDiff += (isHome ? 1 : -1) * (set.homePoints - set.awayPoints);
      }
      // A >=3-way bucket stays on this sequence even if a later metric leaves two tied.
      const key = tied.length === 2 ? [miniWins, row.difference, row.pointsFor]
        : tied.length >= 3 ? [miniWins, miniDiff, row.difference, row.pointsFor] : [row.difference, row.pointsFor];
      return { row, key };
    });
    bucket.sort((a, b) => {
      for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i];
      return a.row.drawCode.localeCompare(b.row.drawCode); // Stable display order only; shared rank below.
    });
    for (let i = 0; i < bucket.length; i++) {
      const item = bucket[i];
      const same = (other: typeof item | undefined) => !!other && item.key.every((value, k) => value === other.key[k]);
      item.row.rank = same(bucket[i - 1]) ? bucket[i - 1].row.rank : ordered.length + 1;
      item.row.tied = same(bucket[i - 1]) || same(bucket[i + 1]);
      ordered.push(item);
    }
  }
  return { group, complete: members.length > 0 && games.length === members.length * (members.length - 1) / 2,
    unresolved: rows.some((row) => row.tied), rows: ordered.map(({ row }) => row) };
}

// This is derived from submitted match results; it is never public without a matching approval.
export function calculateFinalStandings(teams: readonly PublicTeam[], matches: readonly PublicMatch[]): FinalStanding[] {
  if (!matches.length || matches.some((match) => match.status !== "FINISHED" || !match.submittedAt || !match.winner)) return [];
  const result: FinalStanding[] = [];
  for (const match of matches.filter((m) => ["FINAL", "THIRD_PLACE", "PLACEMENT"].includes(m.stage))) {
    if (!match.home.team || !match.away.team) return [];
    const winner = match.winner === match.home.team.drawCode ? match.home.team : match.winner === match.away.team.drawCode ? match.away.team : null;
    if (!winner) return [];
    const loser = winner === match.home.team ? match.away.team : match.home.team;
    const rank = match.stage === "FINAL" ? 1 : match.stage === "THIRD_PLACE" ? 3 : match.placement!;
    result.push({ rank, ...winner }, { rank: rank + 1, ...loser });
  }
  result.sort((a, b) => a.rank - b.rank);
  return result.length === teams.length && new Set(result.map((row) => row.drawCode)).size === teams.length
    && result.every((row, i) => row.rank === i + 1 && teams.some((team) => team.drawCode === row.drawCode)) ? result : [];
}

export function phaseLabel(data: { matches: PublicMatch[]; crossPublished: boolean; finalPublished: boolean }) {
  if (data.matches.every((m) => m.status === "FINISHED")) return data.finalPublished ? "比赛已结束" : "最终名次待公布";
  if (data.matches.filter((m) => m.stage === "GROUP").every((m) => m.status === "FINISHED")) return data.crossPublished ? "交叉赛进行中" : "交叉赛对阵待公布";
  return data.matches.some((m) => m.status !== "NOT_STARTED") ? "小组赛进行中" : "小组赛待开始";
}
