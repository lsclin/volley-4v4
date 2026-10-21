import { MatchDetailView } from "@/components/public/match-detail-view";
export const metadata = { title: "比赛详情 · 高新区继往开来排球赛" };
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <MatchDetailView code={code} />;
}
