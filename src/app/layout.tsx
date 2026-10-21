import type { Metadata } from "next";
import "./globals.css";
import { TournamentProvider } from "@/components/public/tournament-provider";
import { AppShell } from "@/components/public/app-shell";

export const metadata: Metadata = {
  title: "高新区继往开来排球赛",
  description: "高新区继往开来排球赛 · 实时比分、赛程与排名",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><TournamentProvider><AppShell>{children}</AppShell></TournamentProvider></body></html>;
}
