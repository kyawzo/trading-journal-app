import { getWorkspacePreference, formatActiveBrokerLabel } from "@/src/lib/workspace-preference";
import Link from "next/link";

const reportModules = [
  {
    title: "Trading Summary (Options)",
    description: "Period P/L, win rate, average winner, and average loser in one quick view.",
    href: "/reports/trading-summary",
  },
  {
    title: "Strategy Performance (Options)",
    description: "Compare outcomes by strategy type, including CSP, CC, and spread structures.",
    href: "/reports/strategy-performance",
  },
  {
    title: "Realized P/L & Open Exposure",
    description: "Separate closed trade results from current open inventory and cost exposure by account and currency.",
    href: "/reports/realized-vs-unrealized",
  },
  {
    title: "Monthly Performance Trend (Options)",
    description: "Track consistency, drawdowns, and recovery month by month for closed options positions.",
    href: "/reports/monthly-trend",
  },
  {
    title: "Monthly Performance Trend (Holdings)",
    description: "Review realized stock holding exits by month using sale and called-away events.",
    href: "/reports/monthly-trend-holdings",
  },
  {
    title: "Holding Performance Snapshot",
    description: "Shows open stock holdings, realized exits, and cost basis quality in one broker-scoped view.",
    href: "/reports/holding-performance",
  },
  {
    title: "Cash Flow Report",
    description: "Review deposits, withdrawals, premiums, fees, and dividends per account.",
    href: "/reports/cash-flow",
  },
  {
    title: "Import Quality Report",
    description: "Audit imported rows, failed rows, and rollback activity for confidence.",
    href: "/reports/import-quality",
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
          {reportModules.map((module) => {
            if (module.href) {
              return (
                <article key={module.title} className="h-full">
                  <Link href={module.href} className="panel-strong section-stack block h-full">
                    <div>
                      <h4 className="item-title">{module.title}</h4>
                      <p className="note mt-2">{module.description}</p>
                    </div>
                  </Link>
                </article>
              );
            }

            return (
              <article key={module.title} className="h-full">
                <div className="panel-strong section-stack h-full">
                  <div>
                    <h4 className="item-title">{module.title}</h4>
                    <p className="note mt-2">{module.description}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
