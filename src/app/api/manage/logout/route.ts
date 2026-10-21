import { assertSameOrigin, staffSession } from "@/lib/four-v-four/staff-session";
import { staffError, staffJson } from "@/lib/four-v-four/staff-http";
export async function POST(request: Request) {
  try { assertSameOrigin(request); (await staffSession(request)).destroy(); return staffJson({ ok: true }); }
  catch (error) { return staffError(error); }
}
