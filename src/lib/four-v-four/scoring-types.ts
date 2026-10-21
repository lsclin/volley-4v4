import type { PublicParticipant, PublicSet } from "./public-types.ts";
import type { MatchStage } from "./types.ts";

export interface Principal { id: string; version: number; role: "ADMIN" | "SCORER"; courtId: string | null }
export interface ScoreSet extends PublicSet { exclusionReason: string | null }
export interface ScoringState {
  code: string; courtId: string; stage: MatchStage; format: "BO1" | "BO3";
  status: "NOT_STARTED" | "LIVE" | "FINISHED"; version: number;
  homeTeamId: string | null; awayTeamId: string | null; winnerId: string | null;
  startedAt: string | null; submittedAt: string | null; crossApprovalIdAtStart: string | null;
  sets: ScoreSet[];
}
export interface StaffMatch extends ScoringState {
  title: string; courtName: string; netHeightCm: number; targetPoints: number; capPoints: number;
  home: PublicParticipant; away: PublicParticipant; canStart: boolean; needsReview: boolean;
  courtBusyMatchCode: string | null;
}
export type ScoreAction = { type: "START" }
  | { type: "POINT"; setIndex: number; side: "home" | "away"; delta: 1 | -1 }
  | { type: "SET_SCORE"; setIndex: number; homePoints: number; awayPoints: number }
  | { type: "CONFIRM_SET"; setIndex: number }
  | { type: "SUBMIT_MATCH" }
  | { type: "CORRECT_RESULT"; sets: { setIndex: number; homePoints: number; awayPoints: number }[] };
export interface ScoreCommand { requestId: string; expectedVersion: number; action: ScoreAction }
export interface ScoreReceipt { requestId: string; appliedVersion: number; replayed: boolean }
export interface ScoreResponse { receipt: ScoreReceipt; match: StaffMatch }

export class ScoringError extends Error {
  code: string; status: number; match?: StaffMatch;
  constructor(code: string, message: string, status = 422, match?: StaffMatch) { super(message); this.name = "ScoringError"; this.code = code; this.status = status; this.match = match; }
}
