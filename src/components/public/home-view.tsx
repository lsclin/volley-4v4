"use client";

import Link from "next/link";
import { courtBoard, matchTitle, participantLabel, phaseLabel, scoreView } from "@/lib/four-v-four/public-logic";
import type { PublishedSchedule } from "@/lib/four-v-four/public-types";
import { DataGate, Unpublished, useTournament } from "./tournament-provider";
import { StatusTag, TeamName } from "./match-card";
import { MyTeam } from "./my-team";

function CourtBoard({ data, court }: { data: PublishedSchedule; court: PublishedSchedule["courts"][number] }) {
  const board = courtBoard(data.matches, court.id);
  const match = board.primary;
  const score = match ? scoreView(match) : null;
  return <section className="card court-board" aria-label={`${court.name}看板`} data-court={court.id}>
    <div className="row"><h2 className="court-title">{court.name}<span> · {(court.netHeightCm / 100).toFixed(2)}m</span></h2>
      {board.current ? <StatusTag status="LIVE" /> : board.previous ? <span className="tag done">上一场已结束</span> : <span className="tag">等待开始</span>}</div>
    {match ? <>
      <Link className="board-main" href={`/matches/${match.code}`}>
        <p className="minor">{board.current ? "当前比赛" : board.previous ? "上一场" : "下一场"} · {matchTitle(match, data.matches)}</p>
        <div className="board-score"><TeamName participant={match.home} matches={data.matches} winner={match.winner === match.home.team?.drawCode} />
          <div className="board-points"><strong className={board.current ? "live-score" : ""}>{score!.primary}</strong>
            <span>{match.format === "BO3" && match.status !== "NOT_STARTED" ? score!.current ? `第 ${score!.current.setIndex} 局 ${score!.current.homePoints}:${score!.current.awayPoints}` : "总局分" : board.previous && !board.current ? "最终比分" : board.current ? "第 1 局" : "等待开始"}</span>
          </div><TeamName participant={match.away} matches={data.matches} winner={match.winner === match.away.team?.drawCode} /></div>
      </Link>
      {board.next && board.next !== match && <div className="board-next"><Link href={`/matches/${board.next.code}`}><span className="tag next">下一场</span><b>{participantLabel(board.next.home, data.matches)} <span className="vs">vs</span> {participantLabel(board.next.away, data.matches)}</b></Link>{!board.current && <p className="minor">等待开始</p>}</div>}
      {board.complete && <p className="board-complete">本场地比赛已完成</p>}
      {match.needsReview && <p className="review-note">原对阵与成绩保留 · 待复核</p>}
    </> : <p className="notes">暂无已发布比赛</p>}
  </section>;
}
export function HomeView() {
  const { data } = useTournament();
  return <DataGate>{data && <>
    <section className="hero"><p className="hero-location">{data.publication === "unconfigured" ? "高新区室外排球场" : data.location}</p>
      <h2>{data.publication === "published" ? phaseLabel(data) : "赛程待发布"}</h2>
      <p className="hero-subtitle">{data.publication === "unconfigured" ? "高新区继往开来排球赛" : data.name}</p>
      <small>实时比分与比赛进度</small></section>
    {data.publication !== "unconfigured" && data.noticeText && <aside className="notice" aria-label="赛事公告">{data.noticeText}</aside>}
    {data.publication === "published" ? <><div className="court-boards">{data.courts.map((court) => <CourtBoard key={court.id} court={court} data={data} />)}</div><MyTeam data={data} /></> : <Unpublished />}
  </>}</DataGate>;
}
