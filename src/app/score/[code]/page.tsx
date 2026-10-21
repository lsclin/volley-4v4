import { ScoreView } from "@/components/staff/score-view";
export const metadata = { title: "实时记分 · 高新区继往开来排球赛" };
export default async function Page({ params }: { params: Promise<{ code: string }> }) { return <ScoreView code={(await params).code} />; }
