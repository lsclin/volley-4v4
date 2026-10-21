"use client";
import Link from "next/link";
import { useStaffSession } from "./staff-client";
export function StaffReturnLink({ code, courtId }: { code: string; courtId: string }) {
  const { data } = useStaffSession(); const actor = data?.actor;
  return actor && (actor.role === "ADMIN" || actor.courtId === courtId) ? <Link className="button" href={`/score/${code}`}>返回记分台</Link> : null;
}
