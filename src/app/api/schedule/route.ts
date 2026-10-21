import { getFourVFourDatabase } from "@/lib/four-v-four/database";
import { readPublicSchedule } from "@/lib/four-v-four/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await readPublicSchedule(getFourVFourDatabase()), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "4v4赛事数据暂不可用，请完成独立数据库配置和迁移" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
