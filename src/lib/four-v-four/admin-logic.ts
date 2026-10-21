import type { AdminMatch, CrossPreview, TieBreaks } from "./admin-types.ts";
import type { GroupStanding } from "./public-types.ts";
import { ScoringError } from "./scoring-types.ts";

// Only completely tied buckets may be reordered. Earlier ranking metrics remain authoritative.
export function previewCross(groups: GroupStanding[], matches: AdminMatch[], tieBreaks: TieBreaks = {}): CrossPreview {
  const allowed = new Set<string>(); const unresolved: string[] = [];
  const rankings = groups.map((group) => {
    const ordered: string[] = [];
    for (const rank of [...new Set(group.rows.map((row) => row.rank))]) {
      const bucket = group.rows.filter((row) => row.rank === rank);
      const key = `${group.group}:${rank}`;
      if (bucket.length > 1) {
        allowed.add(key);
        const supplied = tieBreaks[key];
        if (!supplied) unresolved.push(key);
        else if (supplied.length !== bucket.length || new Set(supplied).size !== bucket.length || supplied.some((code) => !bucket.some((row) => row.drawCode === code))) {
          throw new ScoringError("INVALID_TIE_BREAK", "人工裁定只能排列当前完全并列的队伍");
        }
        ordered.push(...(supplied ?? bucket.map((row) => row.drawCode)));
      } else ordered.push(bucket[0].drawCode);
    }
    return { group: group.group, drawCodes: ordered };
  });
  if (Object.keys(tieBreaks).some((key) => !allowed.has(key))) throw new ScoringError("INVALID_TIE_BREAK", "排名已变化，请重新核对需要裁定的并列队伍", 409);
  const rankTeam = (ref: string) => {
    const rank = /^rank:([AB]):(\d+)$/.exec(ref);
    return rank ? rankings.find((group) => group.group === rank[1])?.drawCodes[Number(rank[2]) - 1] ?? null : null;
  };
  return { rankings, unresolved, matches: matches.filter((match) => match.stage !== "GROUP").map((match) => {
    const home = rankTeam(match.home.ref), away = rankTeam(match.away.ref);
    const frozen = match.status !== "NOT_STARTED" || !!match.startedAt;
    const actualHome = match.home.team?.drawCode ?? null, actualAway = match.away.team?.drawCode ?? null;
    return { code: match.code, home, away, actualHome, actualAway, frozen,
      differs: frozen && (!!home && home !== actualHome || !!away && away !== actualAway) };
  }) };
}

export function downstreamDiscrepancies(matches: AdminMatch[]): string[] {
  return matches.filter((match) => match.stage !== "GROUP" && match.status !== "NOT_STARTED" && ["home", "away"].some((side) => {
    const participant = match[side as "home" | "away"];
    const ref = /^(winner|loser):(M\d+)$/.exec(participant.ref);
    if (!ref) return false;
    const source = matches.find((row) => row.code === ref[2]);
    if (!source?.winner || source.status !== "FINISHED") return false;
    const expected = ref[1] === "winner" ? source.winner : source.winner === source.home.team?.drawCode ? source.away.team?.drawCode : source.home.team?.drawCode;
    return participant.team?.drawCode !== expected;
  })).map((match) => match.code);
}

// Display a recorded adjudication without changing the ranking algorithm or earlier metrics.
export function confirmedGroupOrder(groups: GroupStanding[], snapshot: string): GroupStanding[] {
  try {
    const saved: unknown = JSON.parse(snapshot);
    if (!saved || typeof saved !== "object" || !("rankings" in saved) || !Array.isArray(saved.rankings)) return groups;
    const rankings = saved.rankings;
    return groups.map((group) => {
      const entry = rankings.find((row: unknown) => !!row && typeof row === "object" && "group" in row && row.group === group.group);
      if (!entry || !Array.isArray(entry.drawCodes) || entry.drawCodes.length !== group.rows.length || new Set(entry.drawCodes).size !== group.rows.length) return group;
      const codes: unknown[] = entry.drawCodes;
      // A stored order must keep every team within its original completely-tied bucket.
      if (group.rows.some((row) => {
        const index = codes.indexOf(row.drawCode);
        const bucketSize = group.rows.filter((other) => other.rank === row.rank).length;
        return index < row.rank - 1 || index >= row.rank - 1 + bucketSize;
      })) return group;
      return { ...group, unresolved: false, rows: codes.map((code, index) => ({ ...group.rows.find((row) => row.drawCode === code)!, rank: index + 1, tied: false })) };
    });
  } catch { return groups; }
}
