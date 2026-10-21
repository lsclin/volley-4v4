"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { LogOut, RefreshCw } from "lucide-react";
import { previewCross } from "@/lib/four-v-four/admin-logic";
import type { AdminMatch, AdminSnapshot, TieBreaks } from "@/lib/four-v-four/admin-types";
import type { AdminCommand } from "@/lib/four-v-four/admin-service";
import { matchTitle, participantLabel, scoreView } from "@/lib/four-v-four/public-logic";
import { StatusTag } from "@/components/public/match-card";
import { staffRequest } from "./staff-client";
import { ScoringError } from "@/lib/four-v-four/scoring-types";
import { ACCESS_CODE_MIN_LENGTH, ACCESS_CODE_MAX_LENGTH } from "@/lib/four-v-four/access-code-policy";

type Action = AdminCommand["action"];
type Save = (action: Action, confirmation?: string) => Promise<boolean>;
function ScorerPasswords({ data, save, busy }: { data: AdminSnapshot; save: Save; busy: boolean }) {
  const [passwords, setPasswords] = useState({ main: "", secondary: "" });
  return <section className="card admin-form"><h2>记分员密码</h2>
    <p className="notes">管理员密码保持不变。修改下方密码后，对应记分员需要重新登录。</p>
    {(["main", "secondary"] as const).map((target) => {
      const credential = data.credentials.find((item) => item.target === target);
      const label = target === "main" ? "主场地记分员" : "副场地记分员";
      return <form className="admin-preview-row" key={target} onSubmit={async (event) => {
        event.preventDefault();
        if (await save({ type: "SET_SCORER_PASSWORD", target, password: passwords[target], expectedCredentialVersion: credential?.version ?? null }, `确认修改${label}密码？该记分员的旧密码和旧登录会话将失效。`)) setPasswords((current) => ({ ...current, [target]: "" }));
      }}>
        <label>{label}新密码<input type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} required minLength={ACCESS_CODE_MIN_LENGTH} maxLength={ACCESS_CODE_MAX_LENGTH} value={passwords[target]} onChange={(event) => setPasswords((current) => ({ ...current, [target]: event.target.value }))} /></label>
        <button className="button" disabled={busy}>保存{label}密码</button>
      </form>;
    })}
  </section>;
}
function TeamForm({ data, save, busy }: { data: AdminSnapshot; save: Save; busy: boolean }) {
  const [names, setNames] = useState(() => Object.fromEntries(data.teams.map((team) => [team.drawCode, team.name])));
  const dirty = data.teams.some((team) => names[team.drawCode].trim() !== team.name);
  return <form className="card admin-form" onSubmit={(event) => { event.preventDefault(); void save({ type: "TEAMS", names }); }}><h2>队伍与抽签结果</h2>
    <p className="notes">将线下抽签结果对应到固定编号。{data.tournament?.startedAt ? "比赛已开始，规模、编号及分组已锁定，仍可修正队名。" : "编号和分组使用固定模板，不提供清空或重新初始化。"}</p>
    {(["A", "B"] as const).map((group) => <fieldset key={group}><legend>{group} 组</legend>{data.teams.filter((team) => team.group === group).map((team) => <label className="admin-team-input" key={team.drawCode}><b>{team.drawCode}</b><input aria-label={`${team.drawCode}队名`} value={names[team.drawCode]} onChange={(event) => setNames({ ...names, [team.drawCode]: event.target.value })} required maxLength={60} placeholder="实际队名" /></label>)}</fieldset>)}
    <button className="button primary-wide" disabled={busy}>保存队名</button>
    {!data.tournament?.schedulePublished && <button type="button" className="button primary-wide" disabled={busy || dirty || data.teams.some((team) => !team.name.trim())} onClick={() => void save({ type: "PUBLISH_SCHEDULE" }, "确认以上抽签结果，并正式发布小组赛程？")}>确认发布小组赛程</button>}
    {!data.tournament?.schedulePublished && <p className="notes">先保存全部队名，再发布。发布前公开页面不展示正式对阵。</p>}
  </form>;
}
function ConfigForm({ data, save, busy }: { data: AdminSnapshot; save: Save; busy: boolean }) {
  const tournament = data.tournament!;
  const [name, setName] = useState(tournament.name); const [location, setLocation] = useState(tournament.location);
  const [rulesText, setRulesText] = useState(tournament.rulesText); const [noticeText, setNoticeText] = useState(tournament.noticeText ?? "");
  return <form className="card admin-form" onSubmit={(event) => { event.preventDefault(); void save({ type: "CONFIG", name, location, rulesText, noticeText }); }}><h2>赛事信息与公告</h2>
    <label>赛事名称<input aria-label="赛事名称" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label>
    <label>比赛地点<input aria-label="比赛地点" value={location} onChange={(event) => setLocation(event.target.value)} maxLength={200} /></label>
    <label>简短公告<textarea aria-label="简短公告" value={noticeText} onChange={(event) => setNoticeText(event.target.value)} maxLength={500} rows={3} placeholder="留空并保存即可撤回公告" /></label>
    <label>赛事规则<textarea aria-label="赛事规则" value={rulesText} onChange={(event) => setRulesText(event.target.value)} maxLength={20000} rows={8} /></label>
    <p className="notes">规则文字按段落公开展示；不改变计分器的人工结束局流程。</p><button className="button primary-wide" disabled={busy}>保存赛事信息</button>
  </form>;
}
function ScheduleRow({ match, data, save, busy }: { match: AdminMatch; data: AdminSnapshot; save: Save; busy: boolean }) {
  const [editing, setEditing] = useState(false); const [courtId, setCourtId] = useState<"main" | "secondary">(match.courtId as "main" | "secondary"); const [sequence, setSequence] = useState(match.sequence);
  const locked = match.status !== "NOT_STARTED" || !!match.startedAt;
  return <article className="card admin-schedule-row"><div className="row"><b>{match.code} · {matchTitle(match, data.matches)}</b><StatusTag status={match.status} /></div>
    <p className="admin-pair">{participantLabel(match.home, data.matches)} <span>vs</span> {participantLabel(match.away, data.matches)}</p>
    <div className="row"><span className="notes">场内顺序 {match.sequence} · {scoreView(match).primary}</span>{locked ? <Link className="small-score-button" href={`/score/${match.code}`}>查看 / 修正</Link> : <button className="small-score-button" onClick={() => setEditing(!editing)}>{editing ? "取消调整" : "调整场地 / 顺序"}</button>}</div>
    {editing && !locked && <form className="admin-inline-form" onSubmit={async (event) => { event.preventDefault(); if (await save({ type: "MOVE_MATCH", code: match.code, expectedVersion: match.version, courtId, sequence })) setEditing(false); }}>
      <label>场地<select aria-label={`${match.code}场地`} value={courtId} onChange={(event) => setCourtId(event.target.value as "main" | "secondary")}>{data.courts.map((court) => <option value={court.id} key={court.id}>{court.name}</option>)}</select></label>
      <label>插入顺序<input aria-label={`${match.code}顺序`} type="number" min={1} max={100} value={sequence} onChange={(event) => setSequence(Number(event.target.value))} required /></label>
      <button className="button" disabled={busy}>保存调整</button><p className="notes">插入该位置，后续未开始场次顺延；已开始或结束的位置保持不变。</p>
    </form>}
  </article>;
}
function PublicationPanel({ data, save, busy }: { data: AdminSnapshot; save: Save; busy: boolean }) {
  const [tieBreaks, setTieBreaks] = useState<TieBreaks>({}); const [reason, setReason] = useState(""); const [acknowledgePlayed, setAcknowledgePlayed] = useState(false);
  const tournament = data.tournament!;
  const complete = data.groups.every((group) => group.complete);
  const preview = previewCross(data.groups, data.matches, tieBreaks);
  const discrepancies = preview.matches.filter((match) => match.differs);
  return <>
    <section className="card admin-form"><div className="row"><h2>小组排名与交叉赛</h2><span className={`tag ${data.cross.valid ? "live" : "next"}`}>{data.cross.valid ? "已确认" : data.cross.previouslyConfirmed ? "待重新确认" : "待确认"}</span></div>
      {!complete && <p className="muted-banner">全部小组赛提交完成后，才能确认交叉对阵。</p>}
      {data.groups.map((group) => <div className="admin-ranking-group" key={group.group}><h3>{group.group} 组 · {group.complete ? "全部完赛" : "进行中"}</h3>
        <table className="admin-table"><thead><tr><th>名次</th><th>队伍</th><th>胜/负</th><th>净胜分</th></tr></thead><tbody>{group.rows.map((row) => <tr key={row.drawCode}><td>{row.played ? row.rank : "—"}</td><td><b>{row.drawCode}</b> {row.name}{row.tied && complete && <small>完全并列</small>}</td><td>{row.wins}/{row.losses}</td><td>{row.difference}</td></tr>)}</tbody></table>
        {complete && !data.cross.valid && [...new Set(group.rows.filter((row) => row.tied).map((row) => row.rank))].map((rank) => {
          const key = `${group.group}:${rank}`; const codes = tieBreaks[key] ?? group.rows.filter((row) => row.rank === rank).map((row) => row.drawCode);
          return <div className="admin-tie" key={key}><b>第{rank}名起：人工裁定</b><p className="notes">仅排列全部指标相同的队伍，按赛前补充规则裁定。</p>{codes.map((code, index) => <div className="row" key={code}><span>{rank + index}. {code} {data.teams.find((team) => team.drawCode === code)?.name}</span><button className="small-score-button" aria-label={`${code}上移`} disabled={index === 0 || busy} onClick={() => { const next = [...codes]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; setTieBreaks({ ...tieBreaks, [key]: next }); }}>上移</button></div>)}<button className="small-score-button" disabled={busy} onClick={() => setTieBreaks({ ...tieBreaks, [key]: codes })}>{tieBreaks[key] ? "已采用此顺序" : "采用此顺序"}</button></div>;
        })}
      </div>)}
      {complete && <><h3>交叉对阵预览</h3>{preview.matches.map((row) => {
        const match = data.matches.find((item) => item.code === row.code)!;
        const label = (code: string | null, fallback: string) => code ? `${code} ${data.teams.find((team) => team.drawCode === code)?.name ?? ""}` : fallback;
        return <div className="admin-preview-row" key={row.code}><div className="row"><b>{row.code} · {matchTitle(match, data.matches)}</b><span className="minor">{row.frozen ? "实际对阵保留" : "未开始"}</span></div><p>{label(row.frozen ? row.actualHome : row.home, participantLabel(match.home, data.matches))} vs {label(row.frozen ? row.actualAway : row.away, participantLabel(match.away, data.matches))}</p>{row.differs && <p className="review-note">新排名对应 {row.home} vs {row.away}；保留本场实际对阵及比分。</p>}</div>;
      })}
        {!data.cross.valid && <>{preview.unresolved.length > 0 && <p className="review-note">尚有完全并列队伍待裁定，预览暂按展示顺序排列。</p>}
          {data.groups.some((group) => group.unresolved) && <label>裁定依据<textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="填写赛前补充规则及本次裁定依据" /></label>}
          {discrepancies.length > 0 && <label className="admin-check"><input type="checkbox" checked={acknowledgePlayed} onChange={(event) => setAcknowledgePlayed(event.target.checked)} />已核对差异，保留已开始比赛的实际对阵和比分</label>}
          <button className="button primary-wide" disabled={busy || preview.unresolved.length > 0} onClick={() => void save({ type: "CONFIRM_CROSS", sourceRevision: tournament.groupResultsRevision, tieBreaks, reason, acknowledgePlayed }, "确认以上排名、裁定和实际对阵，并正式发布交叉赛？")}>{data.cross.previouslyConfirmed ? "重新确认交叉对阵" : "确认并公布交叉对阵"}</button>
        </>}
      </>}
    </section>
    <section className="card admin-form"><div className="row"><h2>最终名次</h2><span className={`tag ${data.final.valid ? "live" : "next"}`}>{data.final.valid ? "已公布" : data.final.previouslyConfirmed ? "待重新确认" : "待公布"}</span></div>
      {data.final.rankings.length === tournament.mode ? <><p className="notes">{data.final.valid ? "以下名次已正式公布。" : "以下仅为管理员预览，确认前不公开最终名次。"}</p><ol className="admin-final-list">{data.final.rankings.map((row) => <li key={row.drawCode}><b>第{row.rank}名</b><span>{row.drawCode} {row.name}</span></li>)}</ol>
        {data.final.needsReview.length > 0 && <><p className="review-note">半决赛修正涉及 {data.final.needsReview.join("、")}，已保留实际对阵。</p><label className="admin-check"><input type="checkbox" checked={acknowledgePlayed} onChange={(event) => setAcknowledgePlayed(event.target.checked)} />已核对并保留实际对阵</label></>}
        {!data.final.valid && <button className="button primary-wide" disabled={busy || !data.cross.valid} onClick={() => void save({ type: "CONFIRM_FINAL", sourceRevision: tournament.resultsRevision, acknowledgePlayed }, "确认完整最终名次，并向所有人正式公布？")}>确认并公布最终名次</button>}
      </> : <p className="muted-banner">全部正式比赛提交完成且能生成完整、无重复的名次后，显示最终预览。</p>}
      {!data.cross.valid && <p className="notes">交叉赛确认必须有效，才能公布最终名次。</p>}
    </section>
  </>;
}
export function AdminView({ onScoring, onLogout }: { onScoring: () => void; onLogout: () => Promise<void> }) {
  const resource = useSWR<AdminSnapshot>("/api/manage/tournament", staffRequest, { revalidateOnMount: true, dedupingInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false });
  const [tab, setTab] = useState<"event" | "schedule" | "publication" | "settings">("event");
  const [court, setCourt] = useState("main"); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<8 | 10>(8); const [name, setName] = useState("高新区继往开来排球赛");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const data = resource.data;
  const save: Save = async (action, confirmation) => {
    if (busy || needsRefresh || confirmation && !window.confirm(confirmation)) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await staffRequest<{ data: AdminSnapshot }>("/api/manage/tournament", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: data?.tournament?.revision ?? null, action }) });
      await resource.mutate(result.data, false);
      setNotice(action.type === "SET_SCORER_PASSWORD" ? "记分员密码已修改，请告知对应记分员使用新密码重新登录。" : "已保存。正式发布内容将同步更新。");
      return true;
    } catch (failure) {
      if (failure instanceof ScoringError && failure.status === 409 && failure.code === "VERSION_CONFLICT") {
        setNeedsRefresh(true);
        setError("数据已发生变化，本次操作未提交。请点击“刷新管理数据”，重新核对后再操作。");
      } else setError(failure instanceof Error ? failure.message : "操作失败，请刷新核对后再操作。");
      return false;
    }
    finally { setBusy(false); }
  };
  return <>
    <section className="hero"><p className="hero-location">管理员 · 赛事管理</p><h2>{data?.tournament ? `${data.tournament.mode}队赛事` : "赛事初始化"}</h2><p className="hero-subtitle">{data?.tournament?.schedulePublished ? "正式赛程已发布" : "赛前准备"}{data?.tournament?.startedAt ? " · 比赛已开始，抽签结构已锁定" : ""}</p></section>
    <div className="admin-toolbar"><button className="small-score-button" onClick={onScoring}>记分与成绩修正</button><button className="icon-button" aria-label="刷新管理数据" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const latest = await staffRequest<AdminSnapshot>("/api/manage/tournament");
        await resource.mutate(latest, false);
        setNeedsRefresh(false); setError("");
      }
      catch { setError("刷新失败，请重试。请取得最新数据并重新核对后再提交。"); }
      finally { setBusy(false); }
    }}><RefreshCw size={18} /></button><button className="icon-button" aria-label="退出管理员" onClick={() => { void onLogout().catch((failure) => setError(failure instanceof Error ? failure.message : "退出失败")); }}><LogOut size={18} /></button></div>
    <p className="notes">管理页手动刷新；发布时服务器会核对成绩与配置版本。</p>
    {(error || resource.error) && <p className="staff-error" role="alert">{error || resource.error.message}</p>}{notice && <p className="muted-banner" role="status">{notice}</p>}
    {!data ? <p className="staff-loading">{resource.error ? "管理数据暂不可用，请刷新重试。" : "正在读取赛事…"}</p> : !data.tournament ? <form className="card admin-form" onSubmit={(event) => { event.preventDefault(); void save({ type: "INITIALIZE", mode, name }, `确认创建${mode}队赛事并生成固定赛程？已有赛事不能清空或重复初始化。`); }}><h2>创建本次赛事</h2><label>参赛规模<select value={mode} onChange={(event) => setMode(Number(event.target.value) as 8 | 10)}><option value={8}>8队 · 18场</option><option value={10}>10队 · 27场</option></select></label><label>赛事名称<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label><p className="notes">生成A/B分组、固定编号和两片场地赛程。初始化不会写入示例队名或比分，不提供删除或重新初始化功能。</p><button className="button primary-wide" disabled={busy}>生成固定赛程</button></form> : <>
      <div className="tabs admin-tabs" aria-label="赛事管理功能">{([["event", "队伍"], ["schedule", "赛程"], ["publication", "成绩发布"], ["settings", "设置"]] as const).map(([value, label]) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
      <div key={`${data.tournament.revision}:${data.tournament.groupResultsRevision}:${data.tournament.resultsRevision}`} aria-busy={busy}>
        {tab === "event" && <TeamForm data={data} save={save} busy={busy || needsRefresh} />}
        {tab === "schedule" && <><div className="tabs" aria-label="调整场地">{data.courts.map((item) => <button key={item.id} aria-pressed={court === item.id} onClick={() => setCourt(item.id)}>{item.name}</button>)}</div><p className="notes">只调整未开始比赛。已开打的实际安排与比分保持原样。</p>{data.matches.filter((match) => match.courtId === court).map((match) => <ScheduleRow key={`${match.code}:${match.version}`} match={match} data={data} save={save} busy={busy || needsRefresh} />)}</>}
        {tab === "publication" && <PublicationPanel data={data} save={save} busy={busy || needsRefresh} />}
        {tab === "settings" && <><ConfigForm data={data} save={save} busy={busy || needsRefresh} /><ScorerPasswords data={data} save={save} busy={busy || needsRefresh} /></>}
      </div>
    </>}
    <Link className="staff-public-link" href="/">查看公开首页</Link>
  </>;
}
