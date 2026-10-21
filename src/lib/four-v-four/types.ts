export type TournamentMode = 8 | 10;
export type GroupCode = "A" | "B";
export type CourtId = "main" | "secondary";
export type MatchStage = "GROUP" | "SEMIFINAL" | "THIRD_PLACE" | "FINAL" | "PLACEMENT";
export type ParticipantRef = `team:${GroupCode}${number}` | `rank:${GroupCode}:${number}` | `winner:M${number}` | `loser:M${number}`;

export interface ScheduledMatch {
  code: string;
  stage: MatchStage;
  group: GroupCode | null;
  placement: number | null;
  format: "BO1" | "BO3";
  targetPoints: number;
  capPoints: number;
  courtId: CourtId;
  sequence: number;
  homeRef: ParticipantRef;
  awayRef: ParticipantRef;
}

export const COURTS = [
  { id: "main", name: "主场地", netHeightCm: 243 },
  { id: "secondary", name: "副场地", netHeightCm: 224 },
] as const;

export function assertMode(mode: number): asserts mode is TournamentMode {
  if (mode !== 8 && mode !== 10) throw new Error("赛事模式只能是8队或10队");
}

export function teamCodes(mode: TournamentMode): string[] {
  assertMode(mode);
  return ["A", "B"].flatMap((group) => Array.from({ length: mode / 2 }, (_, i) => `${group}${i + 1}`));
}
