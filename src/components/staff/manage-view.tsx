"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import useSWR, { useSWRConfig } from "swr";
import { ChevronRight, LogOut } from "lucide-react";
import { scoreView } from "@/lib/four-v-four/public-logic";
import type { Principal, StaffMatch } from "@/lib/four-v-four/scoring-types";
import { ScoringError } from "@/lib/four-v-four/scoring-types";
import { StatusTag, TeamName } from "@/components/public/match-card";
import { staffRequest, useStaffSession } from "./staff-client";
import { AdminView } from "./admin-view";
import { ACCESS_CODE_MIN_LENGTH, ACCESS_CODE_MAX_LENGTH } from "@/lib/four-v-four/access-code-policy";

function LoginForm({ onLogin, message }: { onLogin: (actor: Principal) => void; message?: string }) {
  const [code, setCode] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <><section className="hero"><p className="hero-location">高新区继往开来排球赛</p><h2>工作人员入口</h2><p className="hero-subtitle">输入访问码，进入对应场地记分台</p></section>
    <section className="card login-card"><h2>访问码登录</h2><p className="notes">主场地、副场地记分员及管理员使用各自访问码。</p>
      <form onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(""); try { const result = await staffRequest<{ actor: Principal }>("/api/manage/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessCode: code }) }); setCode(""); onLogin(result.actor); } catch (failure) { setError(failure instanceof Error ? failure.message : "登录失败，请重试"); } finally { setBusy(false); } }}>
        <label htmlFor="access-code">工作人员访问码</label><input id="access-code" type="password" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="current-password" autoCapitalize="none" spellCheck={false} required minLength={ACCESS_CODE_MIN_LENGTH} maxLength={ACCESS_CODE_MAX_LENGTH} />
        {(error || message) && <p className="staff-error" role="alert">{error || message}</p>}
        <button className="button primary-wide" disabled={busy}>{busy ? "正在登录…" : "进入记分台"}</button>
      </form>
    </section><Link className="staff-public-link" href="/">返回公开首页</Link></>;
}
function pendingCount(credentialId: string, code: string) {
  try { const prefix = `ustc4v4:score:v1:${credentialId}:${code}:`; let count = 0; for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(prefix)) count++; return count; } catch { return 0; }
}
function usePending(credentialId: string, code: string) {
  return useSyncExternalStore((callback) => { window.addEventListener("storage", callback); return () => window.removeEventListener("storage", callback); }, () => pendingCount(credentialId, code), () => 0);
}
function DeskMatch({ match, actor, recommended }: { match: StaffMatch; actor: Principal; recommended: boolean }) {
  const pending = usePending(actor.id, match.code); const score = scoreView(match);
  return <Link className="match-card desk-match" href={`/score/${match.code}`} data-staff-match={match.code}>
    <div className="row"><span className="minor">{match.code} · {match.title}</span><StatusTag status={match.status} /></div>
    <div className="match-pair"><TeamName participant={match.home} /><span className="score-summary"><strong>{score.primary}</strong>{score.current && match.format === "BO3" && <small>第{score.current.setIndex}局 {score.current.homePoints}:{score.current.awayPoints}</small>}</span><TeamName participant={match.away} /></div>
    <div className="desk-match-footer"><span className="minor">{pending ? `${pending}条本机记录待同步` : match.status === "FINISHED" ? actor.role === "ADMIN" ? "可修正成绩" : "成绩已锁定 · 只读" : match.status === "NOT_STARTED" && !match.canStart ? "对阵待确认" : match.courtBusyMatchCode ? `等待 ${match.courtBusyMatchCode} 完成并提交` : recommended ? match.status === "LIVE" ? "继续记分" : "推荐下一场" : "进入记分台"}</span><ChevronRight size={16} /></div>
  </Link>;
}
export function ManageView() {
  const session = useStaffSession(); const actor = session.data?.actor;
  const [adminMode, setAdminMode] = useState<"manage" | "scoring">("manage");
  const { mutate } = useSWRConfig(); const [court, setCourt] = useState<"main" | "secondary">("main"); const [logoutError, setLogoutError] = useState("");
  const desk = useSWR(actor && (actor.role !== "ADMIN" || adminMode === "scoring") ? ["/api/scorer/matches", actor.id, actor.version] : null, ([url]) => staffRequest<{ actor: Principal; name: string; schedulePublished: boolean; matches: StaffMatch[] }>(url), {
    refreshInterval: (latest) => latest?.matches.some((match) => match.status === "LIVE") ? 1000 : 2000, dedupingInterval: 500, shouldRetryOnError: false,
  });
  const logout = async () => {
    await staffRequest("/api/manage/logout", { method: "POST" });
    await session.mutate({ actor: null }, false);
    await mutate((key) => key === "/api/manage/tournament" || Array.isArray(key) && String(key[0]).startsWith("/api/scorer/"), undefined, { revalidate: false });
  };
  if (!session.data && !session.error) return <p className="staff-loading" role="status">正在读取管理入口…</p>;
  if (!actor || (desk.error instanceof ScoringError && desk.error.status === 401)) return <LoginForm onLogin={(loggedIn) => { setAdminMode("manage"); void session.mutate({ actor: loggedIn }, false); }} message={desk.error?.status === 401 ? "会话已失效，请重新输入访问码。" : session.error?.message} />;
  if (actor.role === "ADMIN" && adminMode === "manage") return <AdminView onScoring={() => setAdminMode("scoring")} onLogout={logout} />;
  const selectedCourt = actor.role === "ADMIN" ? court : actor.courtId;
  const matches = desk.data?.matches.filter((match) => match.courtId === selectedCourt) ?? [];
  const recommended = matches.find((match) => match.status === "LIVE") ?? matches.find((match) => match.status === "NOT_STARTED" && match.canStart);
  return <>
    {actor.role === "ADMIN" && <button className="small-score-button" onClick={() => setAdminMode("manage")}>返回赛事管理</button>}
    <div className="staff-identity"><div><span className="tag next">{actor.role === "ADMIN" ? "管理员 · 成绩修正" : actor.courtId === "main" ? "主场地记分员" : "副场地记分员"}</span><p className="notes">{actor.role === "ADMIN" ? "可查看两片场地并修正已提交成绩" : "仅显示授权场地，已提交比赛只读"}</p></div>
      <button className="icon-button" aria-label="退出登录" onClick={async () => { try { await logout(); } catch (error) { setLogoutError(error instanceof Error ? error.message : "退出失败"); } }}><LogOut size={19} /></button></div>
    {actor.role === "ADMIN" && <div className="tabs" aria-label="管理场地">{(["main", "secondary"] as const).map((value) => <button key={value} aria-pressed={court === value} onClick={() => setCourt(value)}>{value === "main" ? "主场地" : "副场地"}</button>)}</div>}
    {logoutError && <p className="staff-error" role="alert">{logoutError}</p>}
    {!desk.data ? <section className="card empty-state"><p>{desk.error ? "比赛列表暂不可用，请重试。" : "正在读取比赛列表…"}</p>{desk.error && <button className="button" onClick={() => void desk.mutate()}>重新加载</button>}</section> : <>
      {!desk.data.schedulePublished && <p className="muted-banner">正式赛程尚未发布，暂不能开始记分。</p>}
      <div className="section-head"><h2>{selectedCourt === "main" ? "主场地" : "副场地"} · 比赛选择</h2><span className="minor">共{matches.length}场</span></div>
      <div className="match-list">{matches.map((match) => <DeskMatch key={match.code} match={match} actor={actor} recommended={recommended?.code === match.code} />)}</div>
    </>}
    <Link className="staff-public-link" href="/">查看公开首页</Link>
  </>;
}
