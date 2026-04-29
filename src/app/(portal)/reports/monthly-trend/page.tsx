import Link from "next/link";
import { PositionStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { formatCurrency } from "@/src/lib/pnl";
import {
  formatActiveBrokerLabel,
  getWorkspacePreference,
} from "@/src/lib/workspace-preference";

type PageProps = {
  searchParams: Promise<{ year?: string }>;
};

const CLOSED_STATUSES: PositionStatus[] = [
  PositionStatus.CLOSED,
  PositionStatus.EXPIRED,
  PositionStatus.ASSIGNED,
  PositionStatus.EXERCISED,
];

function monthKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  const labelDate = new Date(Number(year), Number(month) - 1, 1);
  return labelDate.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

export default async function MonthlyTrendPage({ searchParams }: PageProps) {
  const { year } = await searchParams;
  const workspace = await getWorkspacePreference();

  if (!workspace.activeBrokerAccountId) {
    return (
      <main className="page-shell section-stack">
        <section className="hero-card section-stack">
          <div>
            <p className="eyebrow">Monthly Performance Trend (Options)</p>
            <h2 className="page-title">Month-by-month realized options performance</h2>
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
      },
    },
    select: {
      netCashFlow: true,
      currency: true,
      refreshedAt: true,
      position: {
        select: {
          closedAt: true,
        },
      },
    },
    orderBy: [{ position: { closedAt: "asc" } }],
  });

  const rows = snapshots
    .map((snapshot) => {
      const effectiveCloseDate = snapshot.position.closedAt ?? snapshot.refreshedAt;
      return {
        effectiveCloseDate,
        netCashFlow: Number(snapshot.netCashFlow.toString()),
        currency: snapshot.currency ?? workspace.activeBrokerAccount?.baseCurrency ?? "USD",
      };
    })
    .filter((row): row is { effectiveCloseDate: Date; netCashFlow: number; currency: string } => Boolean(row.effectiveCloseDate));

  const availableYears = Array.from(new Set(rows.map((row) => row.effectiveCloseDate.getFullYear()))).sort((a, b) => b - a);
  const selectedYear = year ? Number(year) : availableYears[0] ?? new Date().getFullYear();
  const filteredRows = rows.filter((row) => row.effectiveCloseDate.getFullYear() === selectedYear);
  const reportCurrency = filteredRows[0]?.currency ?? rows[0]?.currency ?? workspace.activeBrokerAccount?.baseCurrency ?? "USD";

  const monthlyMap = new Map<string, { pnl: number; closedTrades: number }>();
  for (const row of filteredRows) {
    const key = monthKey(row.effectiveCloseDate);
    const current = monthlyMap.get(key) ?? { pnl: 0, closedTrades: 0 };
    current.pnl += row.netCashFlow;
    current.closedTrades += 1;
    monthlyMap.set(key, current);
  }

  const monthlyRows = Array.from(monthlyMap.entries())
    .map(([key, value]) => ({ month: key, ...value }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const yearlyPnl = monthlyRows.reduce((sum, row) => sum + row.pnl, 0);
  const bestMonth = monthlyRows.reduce<{ month: string; pnl: number } | null>(
    (best, row) => (!best || row.pnl > best.pnl ? { month: row.month, pnl: row.pnl } : best),
    null
  );
  const worstMonth = monthlyRows.reduce<{ month: string; pnl: number } | null>(
    (worst, row) => (!worst || row.pnl < worst.pnl ? { month: row.month, pnl: row.pnl } : worst),
    null
  );

  return (
    <main className="page-shell section-stack">
      <section className="hero-card section-stack">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Monthly Performance Trend (Options)</p>
            <h2 className="page-title">Month-by-month realized options performance</h2>
            <p className="page-subtitle">
              Closed options positions grouped by month for the selected year.
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
          {availableYears.length === 0 ? (
            <span className="chip-amber">No closed options positions yet</span>
          ) : (
            availableYears.map((y) => (
              <Link
                key={y}
                href={y === availableYears[0] ? "/reports/monthly-trend" : `/reports/monthly-trend?year=${y}`}
                className={selectedYear === y ? "btn-primary" : "btn-ghost"}
              >
                {y}
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="section-stack">
        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Year Realized P/L</p>
            <p className={yearlyPnl >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {formatCurrency(yearlyPnl, reportCurrency)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Active Trading Months</p>
            <p className="stat-value">{monthlyRows.length}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Best Month</p>
            <p className="stat-value-positive">
              {bestMonth ? `${monthLabel(bestMonth.month)} · ${formatCurrency(bestMonth.pnl, reportCurrency)}` : "-"}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Worst Month</p>
            <p className="stat-value-negative">
              {worstMonth ? `${monthLabel(worstMonth.month)} · ${formatCurrency(worstMonth.pnl, reportCurrency)}` : "-"}
            </p>
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Monthly Breakdown</h3>
          <p className="section-copy">Realized P/L by closing month for selected year.</p>
        </div>

        {monthlyRows.length === 0 ? (
          <div className="empty-state">No closed options positions found for {selectedYear}.</div>
        ) : (
          <ul className="list-stack">
            {monthlyRows.map((row) => (
              <li key={row.month} className="list-card">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="item-title">{monthLabel(row.month)}</h4>
                    <p className="note mt-2">{row.closedTrades} closed position{row.closedTrades === 1 ? "" : "s"}</p>
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
