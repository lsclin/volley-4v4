import { getFourVFourDatabase } from "@/lib/four-v-four/database";
import { readScoringDesk } from "@/lib/four-v-four/scoring-service";
import { sessionPrincipal } from "@/lib/four-v-four/staff-session";
import { staffError, staffJson } from "@/lib/four-v-four/staff-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return staffJson(await readScoringDesk(getFourVFourDatabase(), (await sessionPrincipal(request))!)); }
  catch (error) { return staffError(error); }
}
