import { getWorkspacePreference, formatActiveBrokerLabel } from "@/src/lib/workspace-preference";
import Link from "next/link";

const reportModules = [
  {
    title: "Trading Summary (Options)",
    description: "Period P/L, win rate, average winner, and average loser in one quick view.",
    href: "/reports/trading-summary",
  },
  {
    title: "Strategy Performance",
    description: "Compare outcomes by strategy type, including CSP, CC, and spread structures.",
  },
  {
    title: "Realized vs Unrealized P/L",
    description: "Separate closed trade results from open exposure by account and currency.",
  },
  {
    title: "Monthly Performance Trend",
    description: "Track consistency, drawdowns, and recovery month by month.",
    href: "/reports/monthly-trend",
  },
  {
    title: "Cash Flow Report",
    description: "Review deposits, withdrawals, premiums, fees, and dividends per account.",
  },
  {
    title: "Import Quality Report",
    description: "Audit imported rows, failed rows, and rollback activity for confidence.",
  },
];

export default async function ReportsPage() {
  const workspace = await getWorkspacePreference();

  return (
    <main className="page-shell section-stack">
      <section className="hero-card section-stack">
        <div>
          <p className="eyebrow">Reports</p>
          <h2 className="page-title">Management reporting workspace</h2>
          <p className="page-subtitle">
            Reports are scoped to the active broker account to keep performance and cash analysis clean by currency.
          </p>
        </div>
        <div className="item-row">
          <span className="chip-neutral">Active Broker: {formatActiveBrokerLabel(workspace.activeBrokerAccount)}</span>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Planned Modules</h3>
          <p className="section-copy">
            This menu is now in place. Next, each module below can be implemented as a report view.
          </p>
        </div>

        <div className="stats-grid-3">
          {reportModules.map((module) => (
            <article key={module.title} className="h-full">
              <div className="panel-strong section-stack h-full">
                <div>
                  <h4 className="item-title">{module.title}</h4>
                  <p className="note mt-2">{module.description}</p>
                </div>
                {module.href ? (
                  <Link href={module.href} className="stretched-link" aria-label={`Open ${module.title} report`} />
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
