import Link from "next/link";

const FEATURES = [
  {
    title: "Security headers audit",
    desc: "Flags missing or misconfigured CSP, HSTS, X-Frame-Options and X-Content-Type-Options.",
  },
  {
    title: "TLS/SSL configuration",
    desc: "Checks certificate validity, expiry, and whether HTTP redirects to HTTPS.",
  },
  {
    title: "Exposed paths",
    desc: "Passive, non-destructive checks for commonly-exposed sensitive paths.",
  },
  {
    title: "Cookie security",
    desc: "Flags cookies missing Secure, HttpOnly, or SameSite attributes.",
  },
  {
    title: "Scheduled re-scans",
    desc: "Re-scan a target automatically and see which findings were fixed or regressed.",
  },
];

export default function Home() {
  return (
    <main className="landing">
      <header className="landing-header">
        <span className="brand">
          <span className="brand-mark">SE</span>
          engineScan
        </span>
        <Link href="/dashboard" className="btn btn-secondary">
          Go to dashboard
        </Link>
      </header>

      <section className="landing-hero">
        <span className="landing-eyebrow">Web Vulnerability Scanner</span>
        <h1>Find common web-security misconfigurations before attackers do.</h1>
        <p>
          Submit a URL and get an instant, non-destructive report of missing security headers, TLS
          issues, exposed paths, and insecure cookies — no agent to install, no setup required.
        </p>
        <div className="landing-actions">
          <Link href="/dashboard/scans/new" className="btn btn-primary">
            Run a scan
          </Link>
          <Link href="/dashboard/scans" className="btn btn-secondary">
            View past scans
          </Link>
        </div>

        <div className="landing-features">
          {FEATURES.map((f) => (
            <div key={f.title} className="card landing-feature">
              <p className="landing-feature-title">{f.title}</p>
              <p className="landing-feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
