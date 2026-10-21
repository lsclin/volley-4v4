"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import useSWR from "swr";
import type { PublicSchedule } from "@/lib/four-v-four/public-types";

const TournamentContext = createContext<ReturnType<typeof useTournamentSource> | null>(null);
async function fetchSchedule(url: string): Promise<PublicSchedule> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("赛事数据暂不可用");
  return response.json();
}
function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback); window.addEventListener("offline", callback);
  return () => { window.removeEventListener("online", callback); window.removeEventListener("offline", callback); };
}
function useTournamentSource() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const { data, error, isLoading, mutate } = useSWR<PublicSchedule>("/api/schedule", fetchSchedule, {
    refreshInterval: (latest) => latest?.publication === "published" && latest.matches.some((match) => match.status === "LIVE") ? 1000 : 2000,
    refreshWhenHidden: false, refreshWhenOffline: false,
    revalidateOnFocus: true, dedupingInterval: 500, errorRetryInterval: 3000,
  });
  return { data, error: error as Error | undefined, isLoading, online, retry: () => void mutate() };
}
export function TournamentProvider({ children }: { children: React.ReactNode }) {
  const value = useTournamentSource();
  return <TournamentContext.Provider value={value}>{children}</TournamentContext.Provider>;
}
export function useTournament() {
  const value = useContext(TournamentContext);
  if (!value) throw new Error("赛事数据上下文未加载");
  return value;
}
export function DataGate({ children }: { children: React.ReactNode }) {
  const { data, error, retry, isLoading } = useTournament();
  if (!data) return <section className="card empty-state" role="status">
    <h2>{isLoading ? "正在读取赛事" : "赛事数据暂不可用"}</h2>
    <p>{error ? "请检查网络连接后重试。" : "正在获取最新赛程与比分。"}</p>
    {error && <button className="button" onClick={retry}>重新加载</button>}
  </section>;
  return children;
}
export function Unpublished() {
  const { data } = useTournament();
  return <section className="card empty-state"><h2>赛程待发布</h2><p>{data?.publication === "unconfigured" ? "赛事正在筹备，正式信息将在发布后开放。" : "队伍与赛程尚未正式发布，请稍后查看。"}</p></section>;
}
