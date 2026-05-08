import Link from "next/link";
import { PositionStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { formatCurrency } from "@/src/lib/pnl";
import {
  formatActiveBrokerLabel,
  getWorkspacePreference,
} from "@/src/lib/workspace-preference";

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export default async function RealizedVsUnrealizedPage() {
  const workspace = await getWorkspacePreference();

  if (!workspace.activeBrokerAccountId) {
    return (
      <main className="page-shell section-stack">
        <section className="hero-card section-stack">
          <div>
            <p className="eyebrow">Realized P/L & Open Exposure</p>
            <h2 className="page-title">Separate closed results from current open inventory</h2>
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

  const [
    realizedPositionAggregate,
    realizedHoldingAggregate,
    openPositionCount,
    activeHoldingCount,
    activeHoldingCostAggregate,
  ] = await Promise.all([
    prisma.positionPnlSnapshot.aggregate({
      where: {
        brokerAccountId: workspace.activeBrokerAccountId,
        position: {
          currentStatus: {
            in: [
              PositionStatus.CLOSED,
              PositionStatus.EXPIRED,
              PositionStatus.ASSIGNED,
              PositionStatus.EXERCISED,
            ],
          },
        },
      },
      _sum: {
        netCashFlow: true,
        grossDebits: true,
      },
    }),
    prisma.holdingPnlSnapshot.aggregate({
      where: {
        brokerAccountId: workspace.activeBrokerAccountId,
      },
      _sum: {
        estimatedRealizedPnl: true,
        estimatedCostOfSoldShares: true,
      },
    }),
    prisma.position.count({
      where: {
        brokerAccountId: workspace.activeBrokerAccountId,
        currentStatus: {
          in: [PositionStatus.OPEN, PositionStatus.PARTIALLY_CLOSED, PositionStatus.ROLLED],
        },
      },
    }),
    prisma.holding.count({
      where: {
        brokerAccountId: workspace.activeBrokerAccountId,
        remainingQuantity: { gt: 0 },
      },
    }),
    prisma.holdingPnlSnapshot.aggregate({
      where: {
        brokerAccountId: workspace.activeBrokerAccountId,
      },
      _sum: {
        estimatedOpenCost: true,
      },
    }),
  ]);

  const reportCurrency = workspace.activeBrokerAccount?.baseCurrency ?? "USD";
  const realizedOptionsPnl = Number(realizedPositionAggregate._sum.netCashFlow?.toString() ?? 0);
  const realizedOptionsCapital = Number(realizedPositionAggregate._sum.grossDebits?.toString() ?? 0);
  const realizedOptionsRoic = realizedOptionsCapital > 0 ? (realizedOptionsPnl / realizedOptionsCapital) * 100 : 0;

  const realizedHoldingsPnl = Number(realizedHoldingAggregate._sum.estimatedRealizedPnl?.toString() ?? 0);
  const realizedHoldingsCost = Number(realizedHoldingAggregate._sum.estimatedCostOfSoldShares?.toString() ?? 0);
  const realizedHoldingsRoic = realizedHoldingsCost > 0 ? (realizedHoldingsPnl / realizedHoldingsCost) * 100 : 0;

  const combinedRealizedPnl = realizedOptionsPnl + realizedHoldingsPnl;
  const combinedRealizedCapital = realizedOptionsCapital + realizedHoldingsCost;
  const combinedRealizedRoic = combinedRealizedCapital > 0 ? (combinedRealizedPnl / combinedRealizedCapital) * 100 : 0;

  const openHoldingCost = Number(activeHoldingCostAggregate._sum.estimatedOpenCost?.toString() ?? 0);

  return (
    <main className="page-shell section-stack">
      <section className="hero-card section-stack">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Realized P/L & Open Exposure</p>
            <h2 className="page-title">Separate closed results from current open exposure</h2>
            <p className="page-subtitle">
              This report stays intentionally grounded in what the app can measure today: realized results plus current open inventory and cost exposure.
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
        <div>
          <h3 className="section-heading">Realized Results</h3>
          <p className="section-copy">Closed results from options and holdings, using the same realized-only snapshot bases as the dashboard and report pages.</p>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Options Realized P/L</p>
            <p className={realizedOptionsPnl >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {formatCurrency(realizedOptionsPnl, reportCurrency)}
            </p>
            <p className="note mt-2">ROIC {formatPercent(realizedOptionsRoic)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Holdings Realized P/L</p>
            <p className={realizedHoldingsPnl >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {formatCurrency(realizedHoldingsPnl, reportCurrency)}
            </p>
            <p className="note mt-2">ROIC {formatPercent(realizedHoldingsRoic)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Combined Realized P/L</p>
            <p className={combinedRealizedPnl >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {formatCurrency(combinedRealizedPnl, reportCurrency)}
            </p>
            <p className="note mt-2">ROIC {formatPercent(combinedRealizedRoic)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Realized Capital Base</p>
            <p className="stat-value">{formatCurrency(combinedRealizedCapital, reportCurrency)}</p>
            <p className="note mt-2">Options debits + cost of sold holding shares</p>
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Open Exposure</h3>
          <p className="section-copy">Current open inventory context that is available today, without any unrealized mark-to-market estimate.</p>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Open Positions</p>
            <p className="stat-value">{openPositionCount}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Active Holdings</p>
            <p className="stat-value">{activeHoldingCount}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Open Holding Cost</p>
            <p className="stat-value">{formatCurrency(openHoldingCost, reportCurrency)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Unrealized P/L</p>
            <p className="stat-value">Not Tracked</p>
            <p className="note mt-2">This app currently reports realized only</p>
          </div>
        </div>

        <div className="alert-amber" role="status">
          <p className="text-sm">
            Unrealized P/L is intentionally excluded. The app currently reports realized option cash flow and holding open cost, but it does not calculate live mark-to-market values for open positions or holdings.
          </p>
        </div>
      </section>
    </main>
  );
}
