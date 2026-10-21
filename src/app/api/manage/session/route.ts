import { sessionPrincipal } from "@/lib/four-v-four/staff-session";
import { staffError, staffJson } from "@/lib/four-v-four/staff-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return staffJson({ actor: await sessionPrincipal(request, false) }); }
  catch (error) { return staffError(error); }
}
