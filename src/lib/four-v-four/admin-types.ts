import type { FinalStanding, GroupStanding, PublicMatch, PublicTeam } from "./public-types.ts";

export type TieBreaks = Record<string, string[]>;
export interface AdminMatch extends PublicMatch { version: number; startedAt: string | null }
export interface CrossPreview {
  matches: { code: string; home: string | null; away: string | null; actualHome: string | null; actualAway: string | null; frozen: boolean; differs: boolean }[];
  unresolved: string[];
  rankings: { group: string; drawCodes: string[] }[];
}
export interface AdminSnapshot {
  tournament: { name: string; mode: number; location: string; rulesText: string; noticeText: string | null; revision: number; groupResultsRevision: number; resultsRevision: number; schedulePublished: boolean; startedAt: string | null } | null;
  teams: PublicTeam[];
  courts: { id: string; name: string; netHeightCm: number }[];
  matches: AdminMatch[];
  groups: GroupStanding[];
  cross: { valid: boolean; previouslyConfirmed: boolean };
  final: { valid: boolean; previouslyConfirmed: boolean; rankings: FinalStanding[]; needsReview: string[] };
  credentials: { target: "admin" | "main" | "secondary"; configured: boolean; version: number | null }[];
}
