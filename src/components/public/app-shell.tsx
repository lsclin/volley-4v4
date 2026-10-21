"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartNoAxesColumn, ChevronLeft, House, ListOrdered, Menu } from "lucide-react";
import { useTournament } from "./tournament-provider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { data, error, online, retry } = useTournament();
  const detail = path.startsWith("/matches/");
  const scoring = path.startsWith("/score/"); const staff = scoring || path === "/manage";
  const eventName = data && data.publication !== "unconfigured" ? data.name : "高新区继往开来排球赛";
  const title = path === "/" ? eventName : path === "/schedule" ? "赛程" : path === "/rankings" ? "排名" : path === "/rules" ? "赛事规则" : path === "/manage" ? "管理入口" : detail ? "比赛详情" : eventName;
  const links = [{ href: "/", label: "首页", Icon: House }, { href: "/schedule", label: "赛程", Icon: ListOrdered }, { href: "/rankings", label: "排名", Icon: ChartNoAxesColumn }];
  return <div className="app-shell">
    {!scoring && <header className="top-bar">
      <div className="page-heading">{(detail || path === "/rules") && <Link href={detail ? "/schedule" : "/"} aria-label="返回"><ChevronLeft size={22} /></Link>}<h1>{title}</h1></div>
      <details className="menu-popover"><summary aria-label="打开菜单"><Menu size={23} /></summary>
        <div className="menu-items"><Link href="/rules" onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}>赛事规则</Link>
          <Link href="/manage" onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}>管理入口</Link></div>
      </details>
    </header>}
    {!staff && (!online || error) && <div className="connection-warning" role="status"><span>{data ? "连接中断，当前显示上次读取的数据" : "连接中断，暂无法读取赛事"}</span><button onClick={retry}>重试</button></div>}
    <main id="main-content" className={staff ? "staff-main" : undefined}>{children}</main>
    {!staff && <nav className="bottom-nav" aria-label="主导航">{links.map(({ href, label, Icon }) => {
      const active = path === href || (detail && href === "/schedule");
      return <Link key={href} href={href} aria-current={active ? "page" : undefined}><Icon size={22} strokeWidth={active ? 2.3 : 1.8} /><span>{label}</span></Link>;
    })}</nav>}
  </div>;
}
