"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard/scans", label: "Scans" },
  { href: "/dashboard/scans/new", label: "New scan" },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="nav-tabs">
      {TABS.map((tab) => {
        const isActive =
          tab.href === "/dashboard/scans/new" ? pathname === tab.href : pathname === tab.href || /^\/dashboard\/scans\/[^/]+$/.test(pathname);
        return (
          <Link key={tab.href} href={tab.href} className={`nav-tab${isActive ? " active" : ""}`}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
