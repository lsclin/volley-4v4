"use client";

import Link from "next/link";
import { matchTitle, scoreView } from "@/lib/four-v-four/public-logic";
import { DataGate, Unpublished, useTournament } from "./tournament-provider";
import { StatusTag, TeamName } from "./match-card";
import { StaffReturnLink } from "@/components/staff/staff-return-link";

export function MatchDetailView({ code }: { code: string }) {
  const { data } = useTournament();
  if (data?.publication !== "published") return <DataGate><Unpublished /></DataGate>;
  const match = data.matches.find((m) => m.code === code);
  if (!match) return <section className="card empty-state"><h2>未找到这场比赛</h2><p>请从正式赛程选择比赛。</p><Link className="button" href="/schedule">查看赛程</Link></section>;
  const score = scoreView(match);
  const court = data.courts.find((c) => c.id === match.courtId);
  return <>
    <div className="detail-meta row"><span className="minor">{match.code} · {court?.name} {court ? `${(court.netHeightCm / 100).toFixed(2)}m` : ""}</span><StatusTag status={match.status} /></div>
    <section className="card detail-scoreboard"><h2>{matchTitle(match, data.matches)} · {match.format}</h2>
      {match.format === "BO3" && match.status === "LIVE" && <p className="set-total">总局分 {score.home} : {score.away}</p>}
      <div className="detail-teams"><TeamName participant={match.home} matches={data.matches} winner={match.winner === match.home.team?.drawCode} /><span className="vs">VS</span><TeamName participant={match.away} matches={data.matches} winner={match.winner === match.away.team?.drawCode} /></div>
      <p className={`detail-points ${match.status === "LIVE" ? "live-score" : ""}`}>{match.status === "NOT_STARTED" ? "VS" : match.format === "BO1" ? score.primary : score.current ? `${score.current.homePoints} : ${score.current.awayPoints}` : `${score.home} : ${score.away}`}</p>
      <p className="notes">{match.status === "NOT_STARTED" ? "等待开始" : match.status === "FINISHED" ? match.format === "BO1" ? "最终比分" : "最终总局分" : score.current ? `第 ${score.current.setIndex} 局 · ${match.targetPoints} 分制` : "局分已确认，整场待提交"}</p>
    </section>
    {match.stage !== "GROUP" && !data.crossPublished && <p className="muted-banner">{match.needsReview ? "本场原实际对阵及比分保留，待管理员复核；交叉赛整体对阵待重新确认。" : "交叉赛对阵待公布，当前显示名次占位。"}</p>}
    {match.format === "BO3" && <section className="card set-records"><div className="section-head"><h2>本场局分</h2><span className="minor">三局两胜</span></div>
      {match.sets.length ? match.sets.map((set) => <div className={`set-row ${set.excluded ? "excluded-set" : ""}`} key={set.setIndex}><span>第 {set.setIndex} 局</span><b>{set.homePoints} : {set.awayPoints}</b><span className="minor">{set.excluded ? "已排除 · 不计成绩" : set.confirmed ? "已确认" : "当前局"}</span></div>) : <p className="notes">暂无局分记录</p>}
      {score.current && !match.sets.some((set) => set.setIndex === score.current!.setIndex && !set.excluded) && <div className="set-row"><span>第 {score.current.setIndex} 局</span><b>0 : 0</b><span className="minor">当前局</span></div>}
    </section>}
    <p className="notes">{match.format === "BO1" ? `小组赛 ${match.targetPoints} 分制，领先 2 分，${match.capPoints} 分封顶。` : `交叉赛每局 ${match.targetPoints} 分，领先 2 分，${match.capPoints} 分封顶。`}以现场裁判确认及提交成绩为准。</p>
    <StaffReturnLink code={match.code} courtId={match.courtId} />
  </>;
}
