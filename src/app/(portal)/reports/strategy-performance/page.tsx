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

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export default async function StrategyPerformancePage({ searchParams }: PageProps) {
  const { period } = await searchParams;
  const workspace = await getWorkspacePreference();
  const periodStart = resolvePeriodStart(period);
  const selectedPeriod = (period ?? "90d").toLowerCase();

  if (!workspace.activeBrokerAccountId) {
    return (
      <main className="page-shell section-stack">
        <section className="hero-card section-stack">
          <div>
            <p className="eyebrow">Strategy Performance (Options)</p>
            <h2 className="page-title">Compare results by strategy type</h2>
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
      grossDebits: true,
      totalFees: true,
      currency: true,
      position: {
        select: {
          strategyType: true,
        },
      },
    },
    orderBy: [{ refreshedAt: "desc" }],
  });

  const rows = snapshots.map((snapshot) => ({
    strategyType: snapshot.position.strategyType,
    netCashFlow: Number(snapshot.netCashFlow.toString()),
    grossDebits: Number(snapshot.grossDebits.toString()),
    totalFees: Number(snapshot.totalFees.toString()),
    currency: snapshot.currency ?? workspace.activeBrokerAccount?.baseCurrency ?? "USD",
  }));

  const reportCurrency = rows[0]?.currency ?? workspace.activeBrokerAccount?.baseCurrency ?? "USD";
  const totalClosed = rows.length;
  const totalRealizedPnl = rows.reduce((sum, row) => sum + row.netCashFlow, 0);

  const byStrategy = new Map<string, {
    strategyType: string;
    closedTrades: number;
    winners: number;
    losers: number;
    breakeven: number;
    realizedPnl: number;
    grossDebits: number;
    totalFees: number;
  }>();

  for (const row of rows) {
    const existing = byStrategy.get(row.strategyType) ?? {
      strategyType: row.strategyType,
      closedTrades: 0,
      winners: 0,
      losers: 0,
      breakeven: 0,
      realizedPnl: 0,
      grossDebits: 0,
      totalFees: 0,
    };

    existing.closedTrades += 1;
    existing.realizedPnl += row.netCashFlow;
    existing.grossDebits += row.grossDebits;
    existing.totalFees += row.totalFees;

    if (row.netCashFlow > 0) {
      existing.winners += 1;
    } else if (row.netCashFlow < 0) {
      existing.losers += 1;
    } else {
      existing.breakeven += 1;
    }

    byStrategy.set(row.strategyType, existing);
  }

  const strategyRows = Array.from(byStrategy.values())
    .map((row) => {
      const winRate = row.closedTrades > 0 ? (row.winners / row.closedTrades) * 100 : 0;
      const averagePnl = row.closedTrades > 0 ? row.realizedPnl / row.closedTrades : 0;
      const roic = row.grossDebits > 0 ? (row.realizedPnl / row.grossDebits) * 100 : 0;
      const contribution = totalRealizedPnl !== 0 ? (row.realizedPnl / totalRealizedPnl) * 100 : 0;

      return {
        ...row,
        winRate,
        averagePnl,
        roic,
        contribution,
      };
    })
    .sort((a, b) => b.realizedPnl - a.realizedPnl);

  const topStrategy = strategyRows[0] ?? null;
  const weakestStrategy = strategyRows.length > 0 ? strategyRows[strategyRows.length - 1] : null;

  return (
    <main className="page-shell section-stack">
      <section className="hero-card section-stack">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Strategy Performance (Options)</p>
            <h2 className="page-title">Which options strategies are actually working</h2>
            <p className="page-subtitle">
              Closed options positions grouped by strategy type, using the same broker-scoped realized snapshot base as the other options reports.
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
              href={option.key === "90d" ? "/reports/strategy-performance" : `/reports/strategy-performance?period=${option.key}`}
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
            <p className="stat-label">Closed Positions</p>
            <p className="stat-value">{totalClosed}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Strategies Used</p>
            <p className="stat-value">{strategyRows.length}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Top Strategy</p>
            <p className={topStrategy && topStrategy.realizedPnl >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {topStrategy ? `${topStrategy.strategyType} · ${formatCurrency(topStrategy.realizedPnl, reportCurrency)}` : "-"}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Weakest Strategy</p>
            <p className={weakestStrategy && weakestStrategy.realizedPnl >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {weakestStrategy ? `${weakestStrategy.strategyType} · ${formatCurrency(weakestStrategy.realizedPnl, reportCurrency)}` : "-"}
            </p>
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Strategy Breakdown</h3>
          <p className="section-copy">Compare realized P/L, win rate, ROIC, and fees across your closed options strategies.</p>
        </div>

        {strategyRows.length === 0 ? (
          <div className="empty-state">No closed options positions found for the selected period.</div>
        ) : (
          <ul className="list-stack">
            {strategyRows.map((row) => (
              <li key={row.strategyType} className="list-card">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h4 className="item-title">{row.strategyType}</h4>
                    <p className="note mt-2">
                      {row.closedTrades} closed position{row.closedTrades === 1 ? "" : "s"} ·
                      {" "}Win rate {formatPercent(row.winRate)} ·
                      {" "}ROIC {formatPercent(row.roic)}
                    </p>
                    <div className="item-row mt-3">
                      <span className="chip-neutral">Winners: {row.winners}</span>
                      <span className="chip-neutral">Losers: {row.losers}</span>
                      {row.breakeven > 0 ? <span className="chip-neutral">Breakeven: {row.breakeven}</span> : null}
                    </div>
                  </div>
                  <div className="grid min-w-[280px] gap-3 md:grid-cols-2">
                    <div className="event-metric-card">
                      <p className="event-metric-label">Realized P/L</p>
                      <p className={row.realizedPnl >= 0 ? "event-metric-value text-[var(--success-strong)]" : "event-metric-value text-[var(--danger-strong)]"}>
                        {formatCurrency(row.realizedPnl, reportCurrency)}
                      </p>
                    </div>
                    <div className="event-metric-card">
                      <p className="event-metric-label">Avg P/L per Trade</p>
                      <p className={row.averagePnl >= 0 ? "event-metric-value text-[var(--success-strong)]" : "event-metric-value text-[var(--danger-strong)]"}>
                        {formatCurrency(row.averagePnl, reportCurrency)}
                      </p>
                    </div>
                    <div className="event-metric-card">
                      <p className="event-metric-label">Total Fees</p>
                      <p className="event-metric-value">{formatCurrency(row.totalFees, reportCurrency)}</p>
                    </div>
                    <div className="event-metric-card">
                      <p className="event-metric-label">Contribution</p>
                      <p className={row.contribution >= 0 ? "event-metric-value text-[var(--success-strong)]" : "event-metric-value text-[var(--danger-strong)]"}>
                        {formatPercent(row.contribution)}
                      </p>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
