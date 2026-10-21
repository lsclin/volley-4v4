import { getFourVFourDatabase } from "@/lib/four-v-four/database";
import { authenticateAccessCode } from "@/lib/four-v-four/credentials";
import { assertSameOrigin, checkLoginRate, staffSession } from "@/lib/four-v-four/staff-session";
import { readSmallJson, staffError, staffJson } from "@/lib/four-v-four/staff-http";
import { ScoringError } from "@/lib/four-v-four/scoring-types";
import { isValidAccessCode } from "@/lib/four-v-four/access-code-policy";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); checkLoginRate(); const session = await staffSession(request);
    const input = await readSmallJson(request);
    if (!input || !isValidAccessCode(input.accessCode)) throw new ScoringError("INVALID_CODE", "访问码不正确", 401);
    const actor = await authenticateAccessCode(getFourVFourDatabase(), input.accessCode);
    if (!actor) throw new ScoringError("INVALID_CODE", "访问码不正确", 401);
    session.credentialId = actor.id; session.credentialVersion = actor.version; await session.save();
    return staffJson({ actor });
  } catch (error) { return staffError(error); }
}
