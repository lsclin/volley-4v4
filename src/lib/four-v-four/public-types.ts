import type { GroupCode, MatchStage } from "./types.ts";

export interface PublicTeam { drawCode: string; name: string; group: GroupCode }
export interface PublicParticipant { ref: string; team: Pick<PublicTeam, "drawCode" | "name"> | null }
export interface PublicSet { setIndex: number; homePoints: number; awayPoints: number; confirmed: boolean; excluded: boolean }
export interface PublicMatch {
  code: string; stage: MatchStage; group: GroupCode | null; placement: number | null;
  courtId: string; sequence: number; format: "BO1" | "BO3"; targetPoints: number; capPoints: number;
  status: "NOT_STARTED" | "LIVE" | "FINISHED"; home: PublicParticipant; away: PublicParticipant;
  sets: PublicSet[]; winner: string | null; submittedAt: string | null; needsReview: boolean;
}
export interface StandingRow extends PublicTeam {
  played: number; wins: number; losses: number; pointsFor: number; pointsAgainst: number; difference: number;
  rank: number; tied: boolean;
}
export interface GroupStanding { group: GroupCode; complete: boolean; unresolved: boolean; rows: StandingRow[] }
export interface FinalStanding { rank: number; drawCode: string; name: string }
export interface PublicInfo { name: string; mode: number; location: string; rulesText: string; noticeText: string | null }
export interface PublishedSchedule extends PublicInfo {
  publication: "published"; teams: PublicTeam[]; courts: { id: string; name: string; netHeightCm: number }[];
  matches: PublicMatch[]; groups: GroupStanding[]; crossPublished: boolean; crossNeedsReview: boolean;
  finalPublished: boolean; finalStandings: FinalStanding[]; allFinished: boolean;
}
export type PublicSchedule = PublishedSchedule | ({ publication: "draft"; teams: []; matches: [] } & PublicInfo)
  | { publication: "unconfigured"; teams: []; matches: [] };
