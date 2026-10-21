"use client";
import useSWR from "swr";
import { ScoringError } from "@/lib/four-v-four/scoring-types";
import type { Principal, ScoreCommand, ScoreResponse } from "@/lib/four-v-four/scoring-types";

export async function staffRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, credentials: "same-origin", cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new ScoringError(body.error?.code ?? "SERVICE_UNAVAILABLE", body.error?.message ?? "赛事服务暂不可用", response.status, body.match);
  return body;
}
export function useStaffSession() {
  return useSWR<{ actor: Principal | null }>("/api/manage/session", staffRequest, { revalidateOnFocus: true, shouldRetryOnError: false });
}
export function sendScoreCommand(code: string, command: ScoreCommand) {
  return staffRequest<ScoreResponse>(`/api/scorer/matches/${encodeURIComponent(code)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
}
