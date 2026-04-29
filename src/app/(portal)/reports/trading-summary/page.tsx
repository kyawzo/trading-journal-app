import Link from "next/link";
import { PositionStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { formatCurrency } from "@/src/lib/pnl";
import {
  formatActiveBrokerLabel,
  getWorkspacePreference,
} from "@/src/lib/workspace-preference";

type PageProps = {
  searchParams: Promise<{ period?: string }>;
};

const PERIOD_OPTIONS = [
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "ALL" },
] as const;

const CLOSED_STATUSES: PositionStatus[] = [
  PositionStatus.CLOSED,
  PositionStatus.EXPIRED,
  PositionStatus.ASSIGNED,
  PositionStatus.EXERCISED,
];

function resolvePeriodStart(period: string | undefined) {
  const now = new Date();
  const normalized = period?.toLowerCase() ?? "90d";

  if (normalized === "30d") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  if (normalized === "ytd") {
    return new Date(now.getFullYear(), 0, 1);
  }

  if (normalized === "all") {
    return null;
  }

  return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
}

export default async function TradingSummaryPage({ searchParams }: PageProps) {
  const { period } = await searchParams;
  const workspace = await getWorkspacePreference();
  const periodStart = resolvePeriodStart(period);
  const selectedPeriod = (period ?? "90d").toLowerCase();

  if (!workspace.activeBrokerAccountId) {
    return (
      <main className="page-shell section-stack">
        <section className="hero-card section-stack">
          <div>
            <p className="eyebrow">Trading Summary (Options)</p>
            <h2 className="page-title">Performance overview for closed positions</h2>
            <p className="page-subtitle">Select an active broker account first to view broker-scoped reports.</p>
          </div>
          <div className="item-row">
            <Link href="/broker-accounts" className="btn-primary">Select Active Broker</Link>
            <Link href="/reports" className="btn-ghost">Back to Reports</Link>
          </div>
        </section>
      </main>
    );
  }

  const snapshots = await prisma.positionPnlSnapshot.findMany({
    where: {
      brokerAccountId: workspace.activeBrokerAccountId,
      position: {
        currentStatus: { in: CLOSED_STATUSES },
        ...(periodStart ? { closedAt: { gte: periodStart } } : {}),
      },
    },
    select: {
      netCashFlow: true,
      currency: true,
      position: {
        select: {
          strategyType: true,
        },
      },
    },
    orderBy: [{ refreshedAt: "desc" }],
  });

  const pnlRows = snapshots
    .map((snapshot) => ({
      strategyType: snapshot.position.strategyType,
      netCashFlow: Number(snapshot.netCashFlow.toString()),
      currency: snapshot.currency ?? workspace.activeBrokerAccount?.baseCurrency ?? "USD",
    }));

  const totalClosed = pnlRows.length;
  const winners = pnlRows.filter((row) => row.netCashFlow > 0);
  const losers = pnlRows.filter((row) => row.netCashFlow < 0);
  const breakeven = pnlRows.filter((row) => row.netCashFlow === 0).length;
  const realizedPnl = pnlRows.reduce((sum, row) => sum + row.netCashFlow, 0);
  const averageWinner = winners.length > 0
    ? winners.reduce((sum, row) => sum + row.netCashFlow, 0) / winners.length
    : 0;
  const averageLoser = losers.length > 0
    ? losers.reduce((sum, row) => sum + row.netCashFlow, 0) / losers.length
    : 0;
  const winRate = totalClosed > 0 ? (winners.length / totalClosed) * 100 : 0;
  const reportCurrency = pnlRows[0]?.currency ?? workspace.activeBrokerAccount?.baseCurrency ?? "USD";

  const byStrategy = new Map<string, { count: number; pnl: number }>();
  for (const row of pnlRows) {
    const existing = byStrategy.get(row.strategyType) ?? { count: 0, pnl: 0 };
    existing.count += 1;
    existing.pnl += row.netCashFlow;
    byStrategy.set(row.strategyType, existing);
  }
  const strategyRows = Array.from(byStrategy.entries())
    .map(([strategyType, value]) => ({ strategyType, ...value }))
    .sort((a, b) => b.pnl - a.pnl);

  return (
    <main className="page-shell section-stack">
      <section className="hero-card section-stack">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Trading Summary (Options)</p>
            <h2 className="page-title">Closed-position performance at a glance</h2>
            <p className="page-subtitle">
              This report is broker-scoped and currently focused on options positions, using position PnL snapshots.
            </p>
            <div className="item-row mt-4">
              <span className="chip-neutral">Active Broker: {formatActiveBrokerLabel(workspace.activeBrokerAccount)}</span>
            </div>
          </div>
          <div className="hero-actions">
            <Link href="/reports" className="btn-ghost">Back to Reports</Link>
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div className="item-row">
          {PERIOD_OPTIONS.map((option) => (
            <Link
              key={option.key}
              href={option.key === "90d" ? "/reports/trading-summary" : `/reports/trading-summary?period=${option.key}`}
              className={selectedPeriod === option.key ? "btn-primary" : "btn-ghost"}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="section-stack">
        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Realized P/L</p>
            <p className={realizedPnl >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {formatCurrency(realizedPnl, reportCurrency)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Win Rate</p>
            <p className="stat-value">{winRate.toFixed(1)}%</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Average Winner</p>
            <p className="stat-value-positive">{formatCurrency(averageWinner, reportCurrency)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Average Loser</p>
            <p className="stat-value-negative">{formatCurrency(averageLoser, reportCurrency)}</p>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Closed Positions</p>
            <p className="stat-value">{totalClosed}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Winners</p>
            <p className="stat-value-positive">{winners.length}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Losers</p>
            <p className="stat-value-negative">{losers.length}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Breakeven</p>
            <p className="stat-value">{breakeven}</p>
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Strategy Breakdown</h3>
          <p className="section-copy">Closed trades grouped by strategy type for the selected period.</p>
        </div>

        {strategyRows.length === 0 ? (
          <div className="empty-state">No closed positions found for the selected period.</div>
        ) : (
          <ul className="list-stack">
            {strategyRows.map((row) => (
              <li key={row.strategyType} className="list-card">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="item-title">{row.strategyType}</h4>
                    <p className="note mt-2">{row.count} closed position{row.count === 1 ? "" : "s"}</p>
                  </div>
                  <p className={row.pnl >= 0 ? "stat-value-positive" : "stat-value-negative"}>
                    {formatCurrency(row.pnl, reportCurrency)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
