import { getFourVFourDatabase } from "@/lib/four-v-four/database";
import { performScoreAction, readStaffMatch } from "@/lib/four-v-four/scoring-service";
import { assertSameOrigin, sessionPrincipal } from "@/lib/four-v-four/staff-session";
import { readSmallJson, staffError, staffJson } from "@/lib/four-v-four/staff-http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ code: string }> };
export async function GET(request: Request, context: Context) {
  try { return staffJson({ match: await readStaffMatch(getFourVFourDatabase(), (await sessionPrincipal(request))!, (await context.params).code) }); }
  catch (error) { return staffError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request); const principal = (await sessionPrincipal(request))!;
    return staffJson(await performScoreAction(getFourVFourDatabase(), principal, (await context.params).code, await readSmallJson(request)));
  } catch (error) { return staffError(error); }
}
