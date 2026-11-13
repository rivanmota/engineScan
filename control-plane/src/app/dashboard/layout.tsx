import type { ReactNode } from "react";
import Link from "next/link";
import { ApiKeyProvider } from "./ApiKeyProvider";
import { ApiKeyInput } from "./ApiKeyInput";
import { DashboardNav } from "./DashboardNav";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <ApiKeyProvider>
      <div className="app-shell">
        <header className="app-topbar">
          <Link href="/" className="brand">
            <span className="brand-mark">SE</span>
            StubEngineScan
          </Link>
          <DashboardNav />
          <div className="topbar-actions">
            <ApiKeyInput />
          </div>
        </header>
        <main className="app-main">{children}</main>
      </div>
    </ApiKeyProvider>
  );
}
