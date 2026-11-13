"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  {
    href: "/dashboard/scans",
    label: "Scans",
    isActive: (p: string) => p === "/dashboard/scans" || (/^\/dashboard\/scans\/[^/]+$/.test(p) && p !== "/dashboard/scans/new"),
  },
  { href: "/dashboard/scans/new", label: "New scan", isActive: (p: string) => p === "/dashboard/scans/new" },
  { href: "/dashboard/schedules", label: "Schedules", isActive: (p: string) => p.startsWith("/dashboard/schedules") },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="nav-tabs">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} className={`nav-tab${tab.isActive(pathname) ? " active" : ""}`}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
