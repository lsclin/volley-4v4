"use client";

import { useRef, useSyncExternalStore } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import type { PublishedSchedule } from "@/lib/four-v-four/public-types";
import { determinedTeamMatches } from "@/lib/four-v-four/public-logic";
import { MatchCard } from "./match-card";

const KEY = "volley-4v4:my-team:v1";
let memoryChoice: string | null = null;
let memoryOnly = false;
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener("volley-team-change", callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener("volley-team-change", callback); };
}
function readChoice() { if (memoryOnly) return memoryChoice; try { return localStorage.getItem(KEY); } catch { return memoryChoice; } }
function writeChoice(code: string | null) {
  memoryChoice = code ? JSON.stringify({ version: 1, code }) : null;
  try { if (memoryChoice) localStorage.setItem(KEY, memoryChoice); else localStorage.removeItem(KEY); memoryOnly = false; } catch { memoryOnly = true; }
  window.dispatchEvent(new Event("volley-team-change"));
}
export function MyTeam({ data }: { data: PublishedSchedule }) {
  const raw = useSyncExternalStore(subscribe, readChoice, () => null);
  const dialog = useRef<HTMLDialogElement>(null);
  let code: string | null = null;
  try { const saved = raw ? JSON.parse(raw) : null; if (saved?.version === 1 && typeof saved.code === "string") code = saved.code; } catch { /* Ignore malformed browser-local preferences. */ }
  const selected = data.teams.find((team) => team.drawCode === code);
  const matches = selected ? determinedTeamMatches(data.matches, selected.drawCode) : [];
  return <section className="my-team-section" aria-labelledby="my-team-heading">
    <div className="section-head"><h2 id="my-team-heading">我的队伍</h2><button className="chip" onClick={() => dialog.current?.showModal()}>{selected ? "切换队伍" : "选择队伍"}<ChevronRight size={14} /></button></div>
    {selected && <><div className="chosen-team"><span><b>{selected.drawCode}</b> {selected.name}</span><button className="text-button" onClick={() => writeChoice(null)}>取消选择</button></div>
      <div className="match-list">{matches.map((match) => <MatchCard key={match.code} match={match} matches={data.matches} />)}</div>
      {(!data.crossPublished || data.matches.some((match) => match.stage !== "GROUP" && (!match.home.team || !match.away.team))) && <p className="notes">交叉赛对阵待公布。这里只展示本队已确定的比赛。</p>}</>}
    <dialog ref={dialog} className="team-dialog" aria-labelledby="team-dialog-title" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="dialog-heading"><h2 id="team-dialog-title">选择我的队伍</h2><button aria-label="关闭队伍选择" className="icon-button" onClick={() => dialog.current?.close()}><X size={21} /></button></div>
      <p className="notes">选择将保存在当前浏览器，可随时切换或取消。</p>
      <div className="team-choices">{data.teams.map((team) => <button key={team.drawCode} aria-pressed={selected?.drawCode === team.drawCode} onClick={() => { writeChoice(team.drawCode); dialog.current?.close(); }}><span><b>{team.drawCode}</b> {team.name}</span>{selected?.drawCode === team.drawCode && <Check size={19} />}</button>)}</div>
    </dialog>
  </section>;
}
