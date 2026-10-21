import Link from "next/link";
import { matchTitle, participantLabel, scoreView } from "@/lib/four-v-four/public-logic";
import type { PublicMatch, PublicParticipant } from "@/lib/four-v-four/public-types";

export const STATUS_TEXT = { NOT_STARTED: "未开始", LIVE: "进行中", FINISHED: "已结束" } as const;
export function StatusTag({ status }: { status: PublicMatch["status"] }) {
  return <span className={`tag ${status === "LIVE" ? "live" : status === "FINISHED" ? "done" : ""}`}>{status === "LIVE" && <span className="live-dot" />}{STATUS_TEXT[status]}</span>;
}
export function TeamName({ participant, matches = [], winner = false }: { participant: PublicParticipant; matches?: PublicMatch[]; winner?: boolean }) {
  return <span className={`team-name ${winner ? "winner" : ""}`}>{participant.team ? <><b>{participant.team.drawCode}</b><span>{participant.team.name}</span></> : <span className="placeholder-name">{participantLabel(participant, matches)}</span>}</span>;
}
export function ScoreSummary({ match }: { match: PublicMatch }) {
  const score = scoreView(match);
  return <span className="score-summary"><strong className={match.status === "LIVE" ? "live-score" : ""}>{score.primary}</strong>
    {match.format === "BO3" && match.status !== "NOT_STARTED" && <small>{score.current ? `第 ${score.current.setIndex} 局 ${score.current.homePoints}:${score.current.awayPoints}` : match.status === "FINISHED" ? "总局分" : "整场待提交"}</small>}</span>;
}
export function MatchCard({ match, matches = [], courtName }: { match: PublicMatch; matches?: PublicMatch[]; courtName?: string }) {
  return <Link className={`match-card${match.stage === "GROUP" ? " group-match-card" : ""}`} href={`/matches/${match.code}`} data-match={match.code}>
    <div className="row"><span className="minor">{match.code} · {courtName ?? (match.courtId === "main" ? "主场地" : "副场地")}</span><StatusTag status={match.status} /></div>
    {match.stage !== "GROUP" && <p className="match-title">{matchTitle(match, matches)}</p>}
    <div className="match-pair"><TeamName participant={match.home} matches={matches} winner={match.winner === match.home.team?.drawCode} /><ScoreSummary match={match} /><TeamName participant={match.away} matches={matches} winner={match.winner === match.away.team?.drawCode} /></div>
    {match.needsReview && <p className="review-note">原对阵与成绩保留 · 待复核</p>}
  </Link>;
}
