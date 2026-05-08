import Link from "next/link";
import { prisma } from "@/src/lib/prisma";
import { formatCurrency, formatNumber } from "@/src/lib/pnl";
import {
  formatActiveBrokerLabel,
  getWorkspacePreference,
} from "@/src/lib/workspace-preference";

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

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export default async function HoldingPerformanceSnapshotPage() {
  const workspace = await getWorkspacePreference();

  if (!workspace.activeBrokerAccountId) {
    return (
      <main className="page-shell section-stack">
        <section className="hero-card section-stack">
          <div>
            <p className="eyebrow">Holding Performance Snapshot</p>
            <h2 className="page-title">Holdings performance by symbol</h2>
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
    },
    include: {
      pnlSnapshot: true,
    },
    orderBy: [{ openedAt: "desc" }],
  });

  const reportCurrency = holdings[0]?.pnlSnapshot?.currency ?? workspace.activeBrokerAccount?.baseCurrency ?? "USD";

  const rows = holdings.map((holding) => {
    const remainingShares = toNumber(holding.remainingQuantity);
    const acquiredShares = toNumber(holding.pnlSnapshot?.acquiredShares);
    const soldShares = toNumber(holding.pnlSnapshot?.soldShares);
    const grossPurchaseCost = toNumber(holding.pnlSnapshot?.grossPurchaseCost);
    const grossSaleProceeds = toNumber(holding.pnlSnapshot?.grossSaleProceeds);
    const estimatedCostOfSoldShares = toNumber(holding.pnlSnapshot?.estimatedCostOfSoldShares);
    const estimatedRealizedPnl = toNumber(holding.pnlSnapshot?.estimatedRealizedPnl);
    const estimatedOpenCost = toNumber(holding.pnlSnapshot?.estimatedOpenCost);
    const totalFees = toNumber(holding.pnlSnapshot?.totalFees);
    const effectiveCostBasisPerShare = toNumber(holding.pnlSnapshot?.effectiveCostBasisPerShare);
    const realizedRoic = estimatedCostOfSoldShares > 0 ? (estimatedRealizedPnl / estimatedCostOfSoldShares) * 100 : 0;

    return {
      id: holding.id,
      symbol: holding.symbol,
      status: holding.holdingStatus,
      remainingShares,
      acquiredShares,
      soldShares,
      grossPurchaseCost,
      grossSaleProceeds,
      estimatedCostOfSoldShares,
      estimatedRealizedPnl,
      estimatedOpenCost,
      totalFees,
      effectiveCostBasisPerShare,
      realizedRoic,
      currency: holding.pnlSnapshot?.currency ?? reportCurrency,
    };
  });

  const activeRows = rows
    .filter((row) => row.remainingShares > 0)
    .sort((a, b) => b.estimatedOpenCost - a.estimatedOpenCost);
  const realizedRows = rows
    .filter((row) => row.soldShares > 0)
    .sort((a, b) => b.estimatedRealizedPnl - a.estimatedRealizedPnl);
  const inactiveRows = rows.filter((row) => row.remainingShares <= 0);

  const totalRealizedPnl = rows.reduce((sum, row) => sum + row.estimatedRealizedPnl, 0);
  const totalOpenCost = activeRows.reduce((sum, row) => sum + row.estimatedOpenCost, 0);
  const totalRealizedCost = rows.reduce((sum, row) => sum + row.estimatedCostOfSoldShares, 0);
  const portfolioRealizedRoic = totalRealizedCost > 0 ? (totalRealizedPnl / totalRealizedCost) * 100 : 0;
  const bestHolding = realizedRows[0] ?? null;
  const weakestHolding = realizedRows.length > 0
    ? [...realizedRows].sort((a, b) => a.estimatedRealizedPnl - b.estimatedRealizedPnl)[0]
    : null;

  return (
    <main className="page-shell section-stack">
      <section className="hero-card section-stack">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Holding Performance Snapshot</p>
            <h2 className="page-title">Holdings performance by symbol</h2>
            <p className="page-subtitle">
              Review active inventory, realized exits, cost basis quality, and open holding cost from holding PnL snapshots.
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
        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Holdings Tracked</p>
            <p className="stat-value">{rows.length}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Active Holdings</p>
            <p className="stat-value">{activeRows.length}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Realized P/L</p>
            <p className={totalRealizedPnl >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {formatCurrency(totalRealizedPnl, reportCurrency)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Realized ROIC</p>
            <p className={portfolioRealizedRoic >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {formatPercent(portfolioRealizedRoic)}
            </p>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Open Holding Cost</p>
            <p className="stat-value">{formatCurrency(totalOpenCost, reportCurrency)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Best Realized Holding</p>
            <p className={bestHolding && bestHolding.estimatedRealizedPnl >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {bestHolding ? `${bestHolding.symbol} · ${formatCurrency(bestHolding.estimatedRealizedPnl, bestHolding.currency)}` : "-"}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Weakest Realized Holding</p>
            <p className={weakestHolding && weakestHolding.estimatedRealizedPnl >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {weakestHolding ? `${weakestHolding.symbol} · ${formatCurrency(weakestHolding.estimatedRealizedPnl, weakestHolding.currency)}` : "-"}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Inactive Holdings</p>
            <p className="stat-value">{inactiveRows.length}</p>
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Active Holdings</h3>
          <p className="section-copy">Live inventory with remaining shares, effective cost basis, and open cost.</p>
        </div>

        {activeRows.length === 0 ? (
          <div className="empty-state">No active holdings for the selected broker account.</div>
        ) : (
          <ul className="list-stack">
            {activeRows.map((row) => (
              <li key={row.id} className="list-card">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h4 className="item-title">{row.symbol}</h4>
                    <p className="note mt-2">
                      {formatNumber(row.remainingShares)} shares remaining · cost basis/share {formatCurrency(row.effectiveCostBasisPerShare, row.currency)}
                    </p>
                    <div className="item-row mt-3">
                      <span className="chip">{row.status}</span>
                      <span className="chip-neutral">Acquired: {formatNumber(row.acquiredShares)}</span>
                      {row.soldShares > 0 ? <span className="chip-neutral">Sold: {formatNumber(row.soldShares)}</span> : null}
                    </div>
                  </div>
                  <div className="grid min-w-[280px] gap-3 md:grid-cols-2">
                    <div className="event-metric-card">
                      <p className="event-metric-label">Open Cost</p>
                      <p className="event-metric-value">{formatCurrency(row.estimatedOpenCost, row.currency)}</p>
                    </div>
                    <div className="event-metric-card">
                      <p className="event-metric-label">Realized P/L</p>
                      <p className={row.estimatedRealizedPnl >= 0 ? "event-metric-value text-[var(--success-strong)]" : "event-metric-value text-[var(--danger-strong)]"}>
                        {formatCurrency(row.estimatedRealizedPnl, row.currency)}
                      </p>
                    </div>
                    <div className="event-metric-card">
                      <p className="event-metric-label">Gross Purchase Cost</p>
                      <p className="event-metric-value">{formatCurrency(row.grossPurchaseCost, row.currency)}</p>
                    </div>
                    <div className="event-metric-card">
                      <p className="event-metric-label">Total Fees</p>
                      <p className="event-metric-value">{formatCurrency(row.totalFees, row.currency)}</p>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Realized Holdings</h3>
          <p className="section-copy">Holdings with sold shares, ranked by realized P/L and realized ROIC.</p>
        </div>

        {realizedRows.length === 0 ? (
          <div className="empty-state">No realized holding exits recorded yet for this broker account.</div>
        ) : (
          <ul className="list-stack">
            {realizedRows.map((row) => (
              <li key={`realized-${row.id}`} className="list-card">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h4 className="item-title">{row.symbol}</h4>
                    <p className="note mt-2">
                      Sold {formatNumber(row.soldShares)} shares · realized ROIC {formatPercent(row.realizedRoic)}
                    </p>
                    <div className="item-row mt-3">
                      <span className="chip">{row.status}</span>
                      <span className="chip-neutral">Remaining: {formatNumber(row.remainingShares)}</span>
                    </div>
                  </div>
                  <div className="grid min-w-[280px] gap-3 md:grid-cols-2">
                    <div className="event-metric-card">
                      <p className="event-metric-label">Realized P/L</p>
                      <p className={row.estimatedRealizedPnl >= 0 ? "event-metric-value text-[var(--success-strong)]" : "event-metric-value text-[var(--danger-strong)]"}>
                        {formatCurrency(row.estimatedRealizedPnl, row.currency)}
                      </p>
                    </div>
                    <div className="event-metric-card">
                      <p className="event-metric-label">Sale Proceeds</p>
                      <p className="event-metric-value">{formatCurrency(row.grossSaleProceeds, row.currency)}</p>
                    </div>
                    <div className="event-metric-card">
                      <p className="event-metric-label">Cost of Sold Shares</p>
                      <p className="event-metric-value">{formatCurrency(row.estimatedCostOfSoldShares, row.currency)}</p>
                    </div>
                    <div className="event-metric-card">
                      <p className="event-metric-label">Fees</p>
                      <p className="event-metric-value">{formatCurrency(row.totalFees, row.currency)}</p>
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
