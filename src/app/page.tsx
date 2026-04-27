import Link from "next/link";
import { getCurrentUser } from "@/src/lib/auth";

const featureCards = [
  {
    title: "Trade Management",
    copy: "Track positions, legs, actions, assignments, rolls, and trade journals in one workflow.",
  },
  {
    title: "Holdings Layer",
    copy: "Manage assigned shares, manual stock entries, covered calls, and holding event history.",
  },
  {
    title: "Cash Tracking",
    copy: "Keep deposits, premiums, fees, dividends, and cash balance aligned through the ledger.",
  },
];

export default async function LandingPage() {
  const currentUser = await getCurrentUser();

  return (
    <main className="landing-shell">
      <section className="landing-header-card">
        <div>
          <p className="brand-kicker">Trading Journal</p>
          <h1 className="landing-brand font-[var(--font-body)]">Trading portal for positions, holdings, and cash.</h1>
        </div>

        <nav className="landing-menu" aria-label="Landing menu">
          {currentUser ? (
            <>
              <Link href="/dashboard" className="landing-menu-link">Dashboard</Link>
              <Link href="/broker-accounts" className="landing-menu-link">Broker Accounts</Link>
            </>
          ) : (
            <>
              <Link href="/login" className="landing-menu-link">Sign In</Link>
              <Link href="/signup" className="landing-menu-link">Create Account</Link>
            </>
          )}
        </nav>
      </section>

      <section className="landing-hero-simple">
        <div className="landing-copy-stack">
          <p className="eyebrow">Trading Operating System</p>
          <h2 className="landing-title font-[var(--font-body)]">A cleaner front door for your journal portal.</h2>
          <p className="landing-copy">
            Open the dashboard, move into positions and holdings, and keep the structure ready for imports, broker accounts,
            and future user management.
          </p>
        </div>
      </section>

      <section className="landing-section">
        <div>
          <p className="eyebrow">Core Areas</p>
          <h3 className="section-heading">What the portal covers today</h3>
        </div>

        <div className="landing-feature-grid">
          {featureCards.map((card) => (
            <article key={card.title} className="panel-strong section-stack">
              <h4 className="item-title">{card.title}</h4>
              <p className="section-copy">{card.copy}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
