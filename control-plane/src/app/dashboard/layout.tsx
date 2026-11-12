import type { ReactNode } from "react";
import Link from "next/link";
import { ApiKeyProvider } from "./ApiKeyProvider";
import { ApiKeyInput } from "./ApiKeyInput";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <ApiKeyProvider>
      <div style={{ fontFamily: "sans-serif", maxWidth: 900, margin: "0 auto", padding: 24 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <nav style={{ display: "flex", gap: 16 }}>
            <Link href="/dashboard">Campaigns</Link>
            <Link href="/dashboard/campaigns/new">New campaign</Link>
            <Link href="/dashboard/agents">Agents</Link>
          </nav>
          <ApiKeyInput />
        </header>
        {children}
      </div>
    </ApiKeyProvider>
  );
}
