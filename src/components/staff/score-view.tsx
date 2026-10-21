"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { ChevronLeft, X } from "lucide-react";
import { ScoreQueue, actionLabel, browserScoreJournal } from "@/lib/four-v-four/score-queue";
import { scoreView } from "@/lib/four-v-four/public-logic";
import type { Principal, ScoreAction, StaffMatch } from "@/lib/four-v-four/scoring-types";
import { ScoringError } from "@/lib/four-v-four/scoring-types";
import { StatusTag, TeamName } from "@/components/public/match-card";
import { useTournament } from "@/components/public/tournament-provider";
import { sendScoreCommand, staffRequest, useStaffSession } from "./staff-client";

type Modal = { kind: "edit"; index: number } | { kind: "set" } | { kind: "submit" } | { kind: "correct" } | { kind: "adopt" } | null;
function ScoreModal({ modal, match, onClose, onConfirm }: { modal: NonNullable<Modal>; match: StaffMatch; onClose: () => void; onConfirm: (action: ScoreAction | undefined, openedVersion: number) => boolean | string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [openedVersion] = useState(match.version);
  const [error, setError] = useState("");
  const [values, setValues] = useState(() => {
    const indices = modal.kind === "edit" ? [modal.index] : match.format === "BO1" ? [1] : [1, 2, 3];
    return indices.map((index) => { const set = match.sets.find((item) => item.setIndex === index); return { index, home: set ? String(set.homePoints) : "", away: set ? String(set.awayPoints) : "" }; });
  });
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  const current = scoreView(match).current;
  const title = modal.kind === "edit" ? `修改第 ${modal.index} 局比分` : modal.kind === "set" ? `确认结束第 ${current?.setIndex ?? ""} 局？` : modal.kind === "correct" ? "管理员修正整场成绩" : modal.kind === "adopt" ? "采用服务器当前成绩？" : "核对并提交整场比赛";
  const confirm = () => {
    setError(""); let action: ScoreAction | undefined;
    if (modal.kind === "edit" || modal.kind === "correct") {
      const rows = [];
      for (const value of values) {
        if (modal.kind === "correct" && value.index === 3 && value.home === "" && value.away === "") continue;
        if (!/^\d+$/.test(value.home) || !/^\d+$/.test(value.away) || Number(value.home) > 2_147_483_647 || Number(value.away) > 2_147_483_647) { setError("请填写可存储的非负整数比分"); return; }
        rows.push({ setIndex: value.index, homePoints: Number(value.home), awayPoints: Number(value.away) });
      }
      action = modal.kind === "correct" ? { type: "CORRECT_RESULT", sets: rows } : { type: "SET_SCORE", ...rows[0] };
    } else if (modal.kind === "set" && current) action = { type: "CONFIRM_SET", setIndex: current.setIndex };
    else if (modal.kind === "submit") action = { type: "SUBMIT_MATCH" };
    const result = onConfirm(action, openedVersion);
    if (result === true) onClose();
    else setError(typeof result === "string" ? result : "当前操作未提交，请关闭弹窗查看同步状态并核对比分。");
  };
  return <dialog className="score-dialog" ref={ref} aria-labelledby="score-dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><h2 id="score-dialog-title">{title}</h2><button className="icon-button" aria-label="关闭核对弹窗" onClick={onClose}><X size={21} /></button></div>
    {modal.kind === "edit" || modal.kind === "correct" ? <>
      <div className="edit-score-team-labels"><span>{match.home.team?.drawCode} {match.home.team?.name}</span><span>{match.away.team?.drawCode} {match.away.team?.name}</span></div>
      {values.map((value, position) => <fieldset className="score-edit-row" key={value.index}><legend>第 {value.index} 局{modal.kind === "correct" && value.index === 3 ? "（需要时填写）" : ""}</legend>
        <input aria-label={`第${value.index}局左队比分`} inputMode="numeric" pattern="[0-9]*" maxLength={10} value={value.home} onChange={(event) => setValues((old) => old.map((item, i) => i === position ? { ...item, home: event.target.value } : item))} /><span>:</span>
        <input aria-label={`第${value.index}局右队比分`} inputMode="numeric" pattern="[0-9]*" maxLength={10} value={value.away} onChange={(event) => setValues((old) => old.map((item, i) => i === position ? { ...item, away: event.target.value } : item))} />
      </fieldset>)}
      <p className="notes">{modal.kind === "correct" ? "保存后公开成绩立即更新；受影响的对阵或最终名次需重新确认。原始记录与修改日志保留。" : "整场提交前可回改局分；不删除其他已保存的原始局分。"}</p>
    </> : modal.kind === "set" ? <p className="modal-copy">本局比分 <b>{current?.homePoints} : {current?.awayPoints}</b>。确认后保存本局，按总局分进入下一局或整场核对。</p> : modal.kind === "adopt" ? <p className="modal-copy">将放弃当前浏览器中本场待同步记录，采用刚读取的服务器成绩。已经到达服务器的操作不会因此撤销，请先核对两边比分。</p> : <>
      <p className="modal-copy"><b>{match.home.team?.drawCode} {match.home.team?.name}</b> 对 <b>{match.away.team?.drawCode} {match.away.team?.name}</b></p>
      <div className="submit-set-summary">{match.sets.map((set) => <div className={set.excluded ? "excluded-set" : ""} key={set.setIndex}><span>第{set.setIndex}局</span><b>{set.homePoints} : {set.awayPoints}</b><small>{set.excluded ? "已排除" : ""}</small></div>)}</div>
      <p className="submission-lock-note">提交后仅管理员可修改</p>
    </>}
    {error && <p className="staff-error" role="alert">{error}</p>}
    <div className="modal-buttons"><button className="button secondary" onClick={onClose}>返回核对</button><button className="button" onClick={confirm}>{modal.kind === "submit" ? "确认提交整场" : modal.kind === "set" ? "确认结束本局" : modal.kind === "adopt" ? "确认采用服务器成绩" : "保存比分"}</button></div>
  </dialog>;
}

function ScoringSurface({ initial, actor, pollError }: { initial: StaffMatch; actor: Principal; pollError?: Error }) {
  const router = useRouter(); const { online } = useTournament(); const [modal, setModal] = useState<Modal>(null);
  const [controller] = useState(() => new ScoreQueue({ actor, match: initial, journal: browserScoreJournal(actor.id, initial.code), transport: (command) => sendScoreCommand(initial.code, command), online: () => navigator.onLine }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const submittedHere = useRef(state.pending.some((operation) => operation.command.action.type === "SUBMIT_MATCH"));
  useEffect(() => { controller.receiveServer(initial); }, [initial, controller]);
  useEffect(() => {
    controller.activate(); void controller.sync();
    const onStorage = () => { controller.storageChanged(); void controller.sync(); };
    const sync = () => void controller.sync();
    window.addEventListener("storage", onStorage); window.addEventListener("online", sync);
    const timer = setInterval(sync, 1000);
    return () => { clearInterval(timer); window.removeEventListener("storage", onStorage); window.removeEventListener("online", sync); controller.dispose(); };
  }, [controller]);
  useEffect(() => { if (submittedHere.current && !state.pending.length && !state.blocked && state.server.status === "FINISHED") router.push("/manage"); }, [state.pending.length, state.blocked, state.server.status, router]);
  const match = state.match; const score = scoreView(match); const current = score.current;
  const locked = state.server.status === "FINISHED" && state.pending.length === 0;
  const blocked = !!state.blocked || state.controlPending || locked;
  const synced = online && !pollError && !state.error && !state.blocked && state.pending.length === 0;
  const syncText = synced ? "已同步" : state.syncing && online ? "同步中" : "未同步";
  const canSubmit = match.status === "LIVE" && (match.format === "BO1" ? (current?.homePoints ?? 0) !== (current?.awayPoints ?? 0) : score.home === 2 || score.away === 2);
  const confirm = (action: ScoreAction | undefined, openedVersion: number) => {
    if (modal?.kind === "adopt") return controller.adoptServer();
    if (openedVersion !== controller.getSnapshot().match.version) return "比分已更新，请关闭弹窗核对最新成绩后再操作。原输入尚未提交。";
    if (!action) return false;
    const accepted = controller.enqueue(action);
    if (accepted && action.type === "SUBMIT_MATCH") submittedHere.current = true;
    return accepted;
  };
  return <div className="scoring-surface">
    <header className="scoring-header"><Link href="/manage" aria-label="返回比赛列表"><ChevronLeft size={22} /></Link><h1>实时记分</h1><span className={`tag ${synced ? "live" : "sync-pending"}`} role="status" data-sync-state={syncText}>{syncText}</span></header>
    <div className="row scoring-meta"><span className="minor">{match.code} · {match.courtName} {(match.netHeightCm / 100).toFixed(2)}m</span><StatusTag status={match.status} /></div>
    {!online && <p className="sync-message" role="status">网络已断开。逐分记录保存在本机，尚未同步到公开比分。</p>}
    {state.pending.length > 0 && <p className="sync-message">本机有 {state.pending.length} 条待同步记录。请保留本页，恢复网络后沿用原请求安全重试。</p>}
    {(state.error || pollError) && <p className="staff-error" role="alert">{state.error ?? "服务器记录暂不可读取，当前显示上次读取的数据"}</p>}
    {state.blocked && <section className="conflict-panel" role="alert"><h2>成绩需要核对</h2><p>{state.blocked.message}</p>
      <div className="conflict-comparison"><span>服务器：{scoreView(state.server).primary}</span><span>本机待同步：{score.primary}</span></div>
      <ul>{state.pending.map((operation) => <li key={operation.command.requestId}>{actionLabel(operation.command.action)}</li>)}</ul>
      <button className="button" disabled={state.syncing} onClick={() => setModal({ kind: "adopt" })}>核对后采用服务器成绩</button><p className="notes">未作选择时保留本机记录，不自动覆盖。</p>
    </section>}
    <section className="card operator-scoreboard"><h2>{match.title} · {match.format}</h2>
      {match.format === "BO3" && <p className="set-total">总局分 {match.status === "NOT_STARTED" ? "—" : `${score.home} : ${score.away}`}</p>}
      <div className="operator-teams"><TeamName participant={match.home} /><TeamName participant={match.away} /></div>
      <p className="operator-points">{match.status === "NOT_STARTED" ? "VS" : current ? `${current.homePoints} : ${current.awayPoints}` : score.primary}</p>
      <p className="notes">{match.status === "NOT_STARTED" ? "等待开始" : current ? `第 ${current.setIndex} 局 · ${match.targetPoints} 分制` : match.status === "FINISHED" ? match.format === "BO1" ? "最终比分" : "最终总局分" : "局分已确认，整场待提交"}</p>
    </section>
    {match.needsReview && <p className="muted-banner">原实际对阵和比分保留，待管理员复核；可以继续核对本场记录。</p>}
    {match.status === "NOT_STARTED" && <>
      {state.server.courtBusyMatchCode && <div className="muted-banner" role="status">{match.courtName}已有 <b>{state.server.courtBusyMatchCode}</b> 比赛进行中，请先完成并提交该场，再开始本场。<Link className="staff-public-link" href={`/score/${state.server.courtBusyMatchCode}`}>前往 {state.server.courtBusyMatchCode} 记分台</Link></div>}
      <button className="button primary-wide" disabled={!match.canStart || !!state.server.courtBusyMatchCode || state.controlPending || !!state.blocked || !online} onClick={() => controller.enqueue({ type: "START" })}>开始比赛</button>{!match.canStart && <p className="notes">正式对阵尚未确认或双方尚未确定。</p>}
    </>}
    {match.status === "LIVE" && current && <section className="card score-operations"><div className="section-head"><h2>比分操作</h2><span className="minor">逐分实时同步</span></div>
      <div className="operation-team-labels"><span>{match.home.team?.drawCode} {match.home.team?.name}</span><span>{match.away.team?.drawCode} {match.away.team?.name}</span></div>
      <div className="point-buttons">{(["home", "away"] as const).map((side) => <div className={`point-column ${side}`} key={side}>
        <button className="plus" aria-label={`${side === "home" ? "左" : "右"}队加1分`} disabled={blocked} onClick={() => controller.enqueue({ type: "POINT", setIndex: current.setIndex, side, delta: 1 })}>+1</button>
        <button className="minus" aria-label={`${side === "home" ? "左" : "右"}队减1分`} disabled={blocked || current[side === "home" ? "homePoints" : "awayPoints"] === 0} onClick={() => controller.enqueue({ type: "POINT", setIndex: current.setIndex, side, delta: -1 })}>−1</button>
      </div>)}</div>
      <button className="score-edit-button" disabled={blocked} onClick={() => setModal({ kind: "edit", index: current.setIndex })}>直接修改当前比分</button>
    </section>}
    <section className="card operator-history"><div className="section-head"><h2>本场局分</h2><span className="minor">{locked ? "整场已提交" : "整场提交前可回改"}</span></div>
      {match.sets.length ? match.sets.map((set) => <div className={`operator-set-row ${set.excluded ? "excluded-set" : ""}`} key={set.setIndex}><span>第 {set.setIndex} 局{set.excluded ? <small>已排除 · 不计成绩</small> : !set.confirmed ? <small>当前局</small> : null}</span><b>{set.homePoints} : {set.awayPoints}</b>
        {!locked ? <button className="small-score-button" aria-label={`修改第${set.setIndex}局`} disabled={blocked} onClick={() => setModal({ kind: "edit", index: set.setIndex })}>修改</button> : <span className="minor">{set.excluded ? "原始记录" : "已确认"}</span>}
      </div>) : <p className="notes">暂无局分记录</p>}
    </section>
    {match.status === "LIVE" && <div className="score-submit-actions">
      {match.format === "BO3" && current && <button className="button primary-wide" disabled={blocked || !online || state.pending.length > 0 || current.homePoints === current.awayPoints} onClick={() => setModal({ kind: "set" })}>结束当前局</button>}
      {(match.format === "BO1" || !current) && <button className="button primary-wide" disabled={blocked || !online || state.pending.length > 0 || !canSubmit} onClick={() => setModal({ kind: "submit" })}>{match.format === "BO1" ? "结束并提交比赛" : "核对并提交整场比赛"}</button>}
      <p className="notes">{current && current.homePoints === current.awayPoints ? "双方同分，请补全能够确定本局胜者的比分。" : state.pending.length ? "请先等待比分同步，再确认结束。" : "结束局与提交整场均需人工确认，提交整场后仅管理员可修改。"}</p>
    </div>}
    {locked && <><p className="muted-banner">整场已提交，成绩锁定。只有管理员可以修正。</p>{actor.role === "ADMIN" && <button className="button primary-wide" disabled={!!state.blocked || !online} onClick={() => setModal({ kind: "correct" })}>管理员修正成绩</button>}</>}
    <Link className="staff-public-link" href={`/matches/${match.code}`}>查看公开比赛详情</Link>
    {modal && <ScoreModal key={modal.kind === "edit" ? `edit-${modal.index}` : modal.kind} modal={modal} match={match} onClose={() => setModal(null)} onConfirm={confirm} />}
  </div>;
}

export function ScoreView({ code }: { code: string }) {
  const session = useStaffSession(); const actor = session.data?.actor;
  const snapshot = useSWR(actor ? [`/api/scorer/matches/${encodeURIComponent(code)}`, actor.id, actor.version] : null, ([url]) => staffRequest<{ match: StaffMatch }>(url), { refreshInterval: (latest) => latest?.match.status === "LIVE" ? 1000 : 2000, dedupingInterval: 500, shouldRetryOnError: false, revalidateOnFocus: true });
  if (!session.data && !session.error) return <p className="staff-loading" role="status">正在读取记分权限…</p>;
  if (!actor || snapshot.error?.status === 401) return <section className="card empty-state"><h2>请先登录记分台</h2><p>未同步记录保留在当前浏览器，重新登录后可核对。</p><Link className="button" href="/manage">输入访问码</Link></section>;
  if (snapshot.error instanceof ScoringError && [403, 404].includes(snapshot.error.status)) return <section className="card empty-state"><h2>{snapshot.error.status === 403 ? "无权访问这片场地" : "未找到比赛"}</h2><Link className="button" href="/manage">返回授权比赛列表</Link></section>;
  if (!snapshot.data) return <section className="card empty-state" role="status"><p>{snapshot.error ? "比赛暂不可读取，请重试。" : "正在读取本场记录…"}</p>{snapshot.error && <button className="button" onClick={() => void snapshot.mutate()}>重新加载</button>}</section>;
  return <ScoringSurface key={`${actor.id}:${actor.version}:${code}`} actor={actor} initial={snapshot.data.match} pollError={snapshot.error} />;
}
