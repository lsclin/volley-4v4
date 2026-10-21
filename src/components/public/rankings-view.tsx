"use client";

import type { GroupStanding } from "@/lib/four-v-four/public-types";
import { DataGate, Unpublished, useTournament } from "./tournament-provider";

function GroupTable({ standing }: { standing: GroupStanding }) {
  const hasResults = standing.rows.some((row) => row.played > 0);
  return <section className="card ranking-card"><div className="section-head"><h2>{standing.group} 组排名</h2><span className="minor">{standing.complete ? "小组赛已结束" : hasResults ? "小组赛进行中" : "尚无已结束比赛"}</span></div>
    {hasResults ? <table className="ranking-table"><caption className="sr-only">{standing.group}组即时排名</caption><thead><tr><th scope="col">名次</th><th scope="col">队伍</th><th scope="col">胜</th><th scope="col">负</th><th scope="col">净胜分</th></tr></thead>
      <tbody>{standing.rows.map((row) => <tr key={row.drawCode}><td>{row.rank}{row.tied && <small>并列</small>}</td><th scope="row"><b>{row.drawCode}</b><span>{row.name}</span></th><td>{row.wins}</td><td>{row.losses}</td><td>{row.difference > 0 ? "+" : ""}{row.difference}</td></tr>)}</tbody></table>
      : <p className="ranking-empty">暂无排名</p>}
    {hasResults && standing.unresolved && <p className="notes ranking-note">{standing.complete ? "存在同指标并列，待管理员按赛前补充规则裁定。" : "当前同指标队伍暂列并列名次，随已提交成绩更新。"}</p>}
  </section>;
}
export function RankingsView() {
  const { data } = useTournament();
  return <DataGate>{data?.publication !== "published" ? <Unpublished /> : <>
    {data.finalPublished ? <section className="card final-ranking"><div className="section-head"><h2>最终名次</h2><span className="tag next">已公布</span></div>
      <ol>{data.finalStandings.map((row) => <li key={row.drawCode}><span className={`final-place place-${row.rank}`}>{row.rank}</span><div><b>{row.drawCode}</b> {row.name}</div><span className="minor">{row.rank === 1 ? "冠军" : row.rank === 2 ? "亚军" : row.rank === 3 ? "季军" : `第${row.rank}名`}</span></li>)}</ol>
    </section> : <div className="muted-banner ranking-intro"><strong>实时排名</strong><p>正式结果需管理员确认。{data.allFinished ? "全部比赛已结束，最终名次待公布。" : ""}{data.crossNeedsReview ? "交叉赛对阵待重新确认。" : ""}</p></div>}
    {data.groups.map((standing) => <GroupTable key={standing.group} standing={standing} />)}
    <p className="notes">仅计入已提交的小组赛成绩。先比较胜场；两队并列比较直接交手；三队及以上比较并列队伍间胜场、净胜分，再比较全组净胜分、总得分，不递归重启直接交手比较。</p>
  </>}</DataGate>;
}
