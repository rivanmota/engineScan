import Link from "next/link";

export default function Home() {
  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1>StubEngine Attack Simulation</h1>
      <p>
        Go to the <Link href="/dashboard">dashboard</Link> to create campaigns, start/abort runs, and view agents
        and results.
      </p>
    </main>
  );
}
