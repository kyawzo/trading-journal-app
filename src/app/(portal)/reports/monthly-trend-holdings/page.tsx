import Link from "next/link";
import { HoldingEventType } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { formatCurrency } from "@/src/lib/pnl";
import {
  formatActiveBrokerLabel,
  getWorkspacePreference,
} from "@/src/lib/workspace-preference";

type PageProps = {
  searchParams: Promise<{ year?: string }>;
};

const BUY_EVENT_TYPES = new Set<HoldingEventType>([
  HoldingEventType.ACQUIRED,
  HoldingEventType.TRANSFER_IN,
]);

const SELL_EVENT_TYPES = new Set<HoldingEventType>([
  HoldingEventType.SOLD,
  HoldingEventType.PARTIAL_SELL,
  HoldingEventType.CALLED_AWAY,
]);

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

function toNumber(value: unknown) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (typeof value === "object" && value !== null && "toString" in value) {
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export default async function MonthlyTrendHoldingsPage({ searchParams }: PageProps) {
  const { year } = await searchParams;
  const workspace = await getWorkspacePreference();

  if (!workspace.activeBrokerAccountId) {
    return (
      <main className="page-shell section-stack">
        <section className="hero-card section-stack">
          <div>
            <p className="eyebrow">Monthly Performance Trend (Holdings)</p>
            <h2 className="page-title">Month-by-month realized holdings performance</h2>
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

  const holdings = await prisma.holding.findMany({
    where: {
      brokerAccountId: workspace.activeBrokerAccountId,
      holdingEvents: {
        some: {
          eventType: { in: [HoldingEventType.SOLD, HoldingEventType.PARTIAL_SELL, HoldingEventType.CALLED_AWAY] },
        },
      },
    },
    select: {
      id: true,
      symbol: true,
      costBasisPerShare: true,
      holdingEvents: {
        where: {
          eventType: {
            in: [
              HoldingEventType.ACQUIRED,
              HoldingEventType.TRANSFER_IN,
              HoldingEventType.SOLD,
              HoldingEventType.PARTIAL_SELL,
              HoldingEventType.CALLED_AWAY,
              HoldingEventType.SPLIT,
            ],
          },
        },
        select: {
          eventTimestamp: true,
          eventType: true,
          quantity: true,
          splitRatioNumerator: true,
          splitRatioDenominator: true,
          pricePerShare: true,
          amount: true,
          feeAmount: true,
          currency: true,
        },
        orderBy: [{ eventTimestamp: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: [{ openedAt: "asc" }],
  });

  const realizedRows: Array<{ month: string; pnl: number; currency: string; symbol: string }> = [];

  for (const holding of holdings) {
    let openShares = 0;
    let openCostBasis = 0;
    const fallbackCostBasisPerShare = toNumber(holding.costBasisPerShare);

    for (const event of holding.holdingEvents) {
      const quantity = toNumber(event.quantity);
      const fee = Math.abs(toNumber(event.feeAmount));
      const pricePerShare = toNumber(event.pricePerShare);
      const explicitAmount = Math.abs(toNumber(event.amount));
      const amount = explicitAmount || quantity * pricePerShare;

      if (BUY_EVENT_TYPES.has(event.eventType)) {
        openShares += quantity;
        openCostBasis += amount + fee;
        continue;
      }

      if (event.eventType === HoldingEventType.SPLIT) {
        const numerator = toNumber(event.splitRatioNumerator);
        const denominator = toNumber(event.splitRatioDenominator);
        const splitRatio = denominator > 0 ? numerator / denominator : 0;

        if (splitRatio > 0) {
          openShares *= splitRatio;
        }
        continue;
      }

      if (!SELL_EVENT_TYPES.has(event.eventType)) {
        continue;
      }

      const costBasisPerOpenShare = openShares > 0 ? openCostBasis / openShares : fallbackCostBasisPerShare;
      const soldShareCost = quantity * costBasisPerOpenShare;
      const realizedPnl = amount - soldShareCost - fee;

      realizedRows.push({
        month: monthKey(event.eventTimestamp),
        pnl: realizedPnl,
        currency: event.currency || workspace.activeBrokerAccount?.baseCurrency || "USD",
        symbol: holding.symbol,
      });

      openShares = Math.max(openShares - quantity, 0);
      openCostBasis = Math.max(openCostBasis - soldShareCost, 0);
    }
  }

  const availableYears = Array.from(new Set(realizedRows.map((row) => Number(row.month.slice(0, 4))))).sort((a, b) => b - a);
  const selectedYear = year ? Number(year) : availableYears[0] ?? new Date().getFullYear();
  const filteredRows = realizedRows.filter((row) => Number(row.month.slice(0, 4)) === selectedYear);
  const reportCurrency = filteredRows[0]?.currency ?? realizedRows[0]?.currency ?? workspace.activeBrokerAccount?.baseCurrency ?? "USD";

  const monthlyMap = new Map<string, { pnl: number; realizedExits: number; symbols: Set<string> }>();
  for (const row of filteredRows) {
    const current = monthlyMap.get(row.month) ?? { pnl: 0, realizedExits: 0, symbols: new Set<string>() };
    current.pnl += row.pnl;
    current.realizedExits += 1;
    current.symbols.add(row.symbol);
    monthlyMap.set(row.month, current);
  }

  const monthlyRows = Array.from(monthlyMap.entries())
    .map(([month, value]) => ({
      month,
      pnl: value.pnl,
      realizedExits: value.realizedExits,
      uniqueSymbols: value.symbols.size,
    }))
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
            <p className="eyebrow">Monthly Performance Trend (Holdings)</p>
            <h2 className="page-title">Month-by-month realized holdings performance</h2>
            <p className="page-subtitle">
              Realized stock holding exits grouped by month for the selected year, based on sale and called-away events.
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
            <span className="chip-amber">No realized holding exits yet</span>
          ) : (
            availableYears.map((y) => (
              <Link
                key={y}
                href={y === availableYears[0] ? "/reports/monthly-trend-holdings" : `/reports/monthly-trend-holdings?year=${y}`}
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
            <p className="stat-label">Active Exit Months</p>
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
          <p className="section-copy">Realized holdings P/L by exit month for the selected year.</p>
        </div>

        {monthlyRows.length === 0 ? (
          <div className="empty-state">No realized holding exits found for {selectedYear}.</div>
        ) : (
          <ul className="list-stack">
            {monthlyRows.map((row) => (
              <li key={row.month} className="list-card">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="item-title">{monthLabel(row.month)}</h4>
                    <p className="note mt-2">
                      {row.realizedExits} realized exit{row.realizedExits === 1 ? "" : "s"} across {row.uniqueSymbols} symbol{row.uniqueSymbols === 1 ? "" : "s"}
                    </p>
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
