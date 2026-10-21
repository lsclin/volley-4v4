"use client";

import { DataGate, useTournament } from "./tournament-provider";

export function RulesView() {
  const { data } = useTournament();
  const text = (data && data.publication !== "unconfigured" ? data.rulesText.trim() : "") || "赛事规则待管理员更新。";
  const paragraphs = (text.includes("\n") ? text : text.replace(/。(?=.)/gu, "。\n")).split(/\r?\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return <DataGate>{data?.publication === "unconfigured" ? <section className="card empty-state"><h2>赛事规则待发布</h2><p>赛事正在筹备，请稍后查看。</p></section> : data && <>
    <section className="hero"><p className="hero-location">{data.location}</p><h2>4v4 比赛规则</h2><p className="hero-subtitle">{data.name}</p></section>
    <section className="card rules-content"><h2>赛事章程</h2>{paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>
    {data.noticeText && <aside className="notice" aria-label="赛事公告">{data.noticeText}</aside>}
  </>}</DataGate>;
}
