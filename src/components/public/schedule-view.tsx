"use client";

import { useState } from "react";
import Link from "next/link";
import { MatchCard, StatusTag } from "./match-card";
import { DataGate, Unpublished, useTournament } from "./tournament-provider";
import type { PublicMatch, PublishedSchedule } from "@/lib/four-v-four/public-types";
import { matchTitle, participantLabel, scoreView } from "@/lib/four-v-four/public-logic";

function BracketMatch({ match, data }: { match: PublicMatch; data: PublishedSchedule }) {
  const score = scoreView(match);
  return <Link className="match-card bracket-match" href={`/matches/${match.code}`} aria-label={`${matchTitle(match, data.matches)}：${participantLabel(match.home, data.matches)} 对 ${participantLabel(match.away, data.matches)}`}>
    <div className="row"><span className="minor">{match.code} · {data.courts.find((court) => court.id === match.courtId)?.name}</span><StatusTag status={match.status} /></div>
    <p className="match-title">{matchTitle(match, data.matches)}</p>
    {(["home", "away"] as const).map((side) => <div className={`bracket-team ${match.winner === match[side].team?.drawCode ? "winner" : ""}`} key={side}><span title={participantLabel(match[side], data.matches)}>{participantLabel(match[side], data.matches)}</span><b>{match.status === "NOT_STARTED" ? "—" : score[side]}</b></div>)}
    {score.current && <p className="bracket-current"><span>总局分 {score.home} : {score.away}</span><span>第 {score.current.setIndex} 局 {score.current.homePoints} : {score.current.awayPoints}</span></p>}
    {match.needsReview && <p className="review-note">原对阵保留 · 待复核</p>}
  </Link>;
}

export function CrossBracket({ data }: { data: PublishedSchedule }) {
  const semis = data.matches.filter((m) => m.stage === "SEMIFINAL").sort((a, b) => a.code.localeCompare(b.code));
  const final = data.matches.find((m) => m.stage === "FINAL");
  const third = data.matches.find((m) => m.stage === "THIRD_PLACE");
  const placements = data.matches.filter((m) => m.stage === "PLACEMENT").sort((a, b) => a.placement! - b.placement!);
  return <>
    {!data.crossPublished && <div className="muted-banner">{data.crossNeedsReview ? "交叉赛对阵待管理员重新确认。已开始比赛保留原对阵。" : "交叉赛对阵待公布，暂以小组名次占位。"}</div>}
    <div className="section-head"><h2>四强淘汰赛</h2><span className="minor">主场地 · 2.43m</span></div>
    <p className="scroll-hint">← 左右滑动查看完整对阵图 →</p>
    <div className="bracket-scroll" tabIndex={0} role="region" aria-label="四强淘汰赛对阵图，可左右滑动">
      <div className="bracket-grid">
        <div className="bracket-column">{semis.map((m) => <BracketMatch key={m.code} match={m} data={data} />)}</div>
        <div className="bracket-connections" aria-hidden="true"><svg viewBox="0 0 84 420" preserveAspectRatio="none"><path className="winner-path" d="M0 100H22V210H50V100H84 M0 320H22V210"/><path className="loser-path" d="M0 116H10V390H65V320H84 M0 336H10"/></svg><span className="connection-label winners">胜者</span><span className="connection-label losers">负者</span></div>
        <div className="bracket-column">{final && <BracketMatch match={final} data={data} />}{third && <BracketMatch match={third} data={data} />}</div>
      </div>
    </div>
    <p className="muted-banner">先完成其他名次排位赛，再在主场地依次进行半决赛 1、半决赛 2、季军赛和冠亚军决赛。</p>
    <div className="section-head"><h2>其他名次排位赛</h2></div>
    <div className="match-list">{placements.map((match) => <MatchCard key={match.code} match={match} matches={data.matches} />)}</div>
  </>;
}
export function ScheduleView() {
  const { data } = useTournament();
  const [phase, setPhase] = useState<"group" | "cross">("group");
  const [group, setGroup] = useState<"A" | "B">("A");
  const matches = data?.publication === "published" ? data.matches.filter((match) => match.stage === "GROUP" && match.group === group).sort((a, b) => a.code.localeCompare(b.code)) : [];
  return <DataGate>{data?.publication !== "published" ? <Unpublished /> : <>
    <div className="tabs" role="group" aria-label="比赛阶段">{([['group', '小组赛'], ['cross', '交叉赛']] as const).map(([value, label]) => <button key={value} aria-pressed={phase === value} onClick={() => setPhase(value)}>{label}</button>)}</div>
    {phase === "group" ? <><div className="tabs group-tabs" role="group" aria-label="小组选择">{(["A", "B"] as const).map((value) => <button key={value} aria-pressed={group === value} onClick={() => setGroup(value)}>{value} 组</button>)}</div>
      <div className="team-chips">{data.teams.filter((team) => team.group === group).map((team) => <span key={team.drawCode}><b>{team.drawCode}</b> {team.name}</span>)}</div>
      <div className="section-head"><h2>{group} 组 · 全部对阵</h2><span className="minor">共 {matches.length} 场</span></div>
      <div className="match-list">{matches.map((match) => <MatchCard key={match.code} match={match} matches={data.matches} />)}</div>
    </> : <CrossBracket data={data} />}
  </>}</DataGate>;
}
