import { getFourVFourDatabase } from "@/lib/four-v-four/database";
import { performAdminAction, readAdminTournament } from "@/lib/four-v-four/admin-service";
import { assertSameOrigin, sessionPrincipal } from "@/lib/four-v-four/staff-session";
import { readSmallJson, staffError, staffJson } from "@/lib/four-v-four/staff-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return staffJson(await readAdminTournament(getFourVFourDatabase(), (await sessionPrincipal(request))!)); }
  catch (error) { return staffError(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const principal = (await sessionPrincipal(request))!;
    const input = await readSmallJson(request, 96 * 1024);
    return staffJson(await performAdminAction(getFourVFourDatabase(), principal, input));
  } catch (error) { return staffError(error); }
}
