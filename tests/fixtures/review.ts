import type { PrismaClient } from "../../src/generated/four-v-four/index.js";
import { calculateFinalStandings } from "../../src/lib/four-v-four/public-logic.ts";
import { initializeTournament, publishSchedule, readPublicSchedule, updateTeamNames } from "../../src/lib/four-v-four/repository.ts";
import type { TournamentMode } from "../../src/lib/four-v-four/types.ts";

export type ReviewScenario = "live" | "interval" | "cross" | "cross-upcoming" | "final-pending" | "final-published" | "upcoming";
const NAMES = { A: ["逐风队", "星火队", "飞跃队", "凌云队", "青禾队"], B: ["星辰队", "凌波队", "青锋队", "云帆队", "赤羽队"] };

// Test data is written to an explicitly isolated database, never imported by product UI.
export async function setFixtureScore(db: PrismaClient, code: string, sets: [number, number, boolean][], status: "LIVE" | "FINISHED", stamp = 1) {
  const match = await db.match.findUniqueOrThrow({ where: { id: code } });
  const approval = match.stage !== "GROUP" ? await db.approval.findFirst({ where: { type: "CROSS", invalidatedAt: null } }) : null;
  let home = 0, away = 0;
  for (const [i, [homePoints, awayPoints, confirmed]] of sets.entries()) {
    if (confirmed) { home += Number(homePoints > awayPoints); away += Number(awayPoints > homePoints); }
    const data = { homePoints, awayPoints, confirmed };
    await db.setScore.upsert({ where: { matchId_setIndex: { matchId: code, setIndex: i + 1 } }, create: { matchId: code, setIndex: i + 1, ...data }, update: data });
  }
  await db.match.update({ where: { id: code }, data: { status, version: { increment: 1 }, startedAt: new Date("2026-10-15T01:00:00Z"),
    submittedAt: status === "FINISHED" ? new Date(Date.parse("2026-10-15T02:00:00Z") + stamp * 60000) : null,
    winnerId: status === "FINISHED" ? home > away ? match.homeTeamId : match.awayTeamId : null,
    crossApprovalIdAtStart: approval?.id ?? null } });
}

export async function prepareReviewFixture(db: PrismaClient, mode: TournamentMode, scenario: ReviewScenario) {
  await initializeTournament(db, { mode, name: "高新区继往开来排球赛" }, "review-fixture");
  const teams = await db.team.findMany();
  await updateTeamNames(db, Object.fromEntries(teams.map((team) => [team.drawCode, NAMES[team.group][team.slot - 1]])), 0, "review-fixture");
  await publishSchedule(db, 1, "review-fixture");
  if (scenario === "upcoming") return;
  const groups = await db.match.findMany({ where: { stage: "GROUP" }, orderBy: { code: "asc" } });
  if (scenario === "live" || scenario === "interval") {
    await setFixtureScore(db, "M01", [[25, 21, true]], "FINISHED", 1);
    await setFixtureScore(db, "M02", [[20, 18, false]], "LIVE");
    await setFixtureScore(db, "M03", [[scenario === "live" ? 18 : 25, scenario === "live" ? 16 : 22, scenario === "interval"]], scenario === "live" ? "LIVE" : "FINISHED", 2);
    await db.tournament.update({ where: { id: "current" }, data: { groupResultsRevision: scenario === "live" ? 1 : 2, resultsRevision: scenario === "live" ? 1 : 2 } });
    return;
  }
  for (const [index, match] of groups.entries()) await setFixtureScore(db, match.code, [[25, 17 + index % 6, true]], "FINISHED", index + 1);
  await db.tournament.update({ where: { id: "current" }, data: { groupResultsRevision: groups.length, resultsRevision: groups.length } });
  const standings = await readPublicSchedule(db);
  if (standings.publication !== "published") throw new Error("Fixture must be published");
  const cross = await db.match.findMany({ where: { stage: { not: "GROUP" } }, orderBy: { code: "asc" } });
  for (const match of cross) {
    const resolve = (ref: string) => {
      const rank = /^rank:([AB]):(\d+)$/.exec(ref);
      return rank ? `team:${standings.groups.find((g) => g.group === rank[1])!.rows[Number(rank[2]) - 1].drawCode}` : null;
    };
    await db.match.update({ where: { id: match.id }, data: { homeTeamId: resolve(match.homeRef), awayTeamId: resolve(match.awayRef) } });
  }
  await db.approval.create({ data: { type: "CROSS", sourceRevision: groups.length, snapshot: JSON.stringify({ fixture: true }), approvedBy: "review-fixture" } });
  if (scenario === "cross-upcoming") return;
  const semis = cross.filter((match) => match.stage === "SEMIFINAL");
  if (scenario === "cross") {
    for (const [i, placement] of cross.filter((m) => m.stage === "PLACEMENT").entries()) await setFixtureScore(db, placement.code, [[15, 11, true], [15, 12, true]], "FINISHED", groups.length + i + 1);
    await setFixtureScore(db, semis[0].code, [[15, 12, true], [12, 15, true], [15, 13, true]], "FINISHED", groups.length + 5);
    await setFixtureScore(db, semis[1].code, [[15, 12, true], [10, 8, false]], "LIVE");
    return;
  }
  for (const [i, match] of cross.filter((m) => ["SEMIFINAL", "PLACEMENT"].includes(m.stage)).entries()) await setFixtureScore(db, match.code, [[15, 12, true], [15, 10, true]], "FINISHED", groups.length + i + 1);
  for (const match of cross.filter((m) => ["FINAL", "THIRD_PLACE"].includes(m.stage))) {
    const resolve = async (ref: string) => {
      const [kind, code] = ref.split(":");
      const source = await db.match.findUniqueOrThrow({ where: { id: code } });
      return kind === "winner" ? source.winnerId : source.winnerId === source.homeTeamId ? source.awayTeamId : source.homeTeamId;
    };
    await db.match.update({ where: { id: match.id }, data: { homeTeamId: await resolve(match.homeRef), awayTeamId: await resolve(match.awayRef) } });
    await setFixtureScore(db, match.code, [[15, 11, true], [15, 13, true]], "FINISHED", match.stage === "FINAL" ? 99 : 98);
  }
  await db.tournament.update({ where: { id: "current" }, data: { resultsRevision: groups.length + cross.length } });
  if (scenario === "final-published") {
    const data = await readPublicSchedule(db);
    if (data.publication !== "published") throw new Error("Fixture must be published");
    const rankings = calculateFinalStandings(data.teams, data.matches).map(({ rank, drawCode }) => ({ rank, drawCode }));
    await db.approval.create({ data: { type: "FINAL", sourceRevision: groups.length + cross.length, snapshot: JSON.stringify({ rankings }), approvedBy: "review-fixture" } });
  }
}
