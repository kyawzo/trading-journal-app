import Link from "next/link";
import { PositionStatus } from "@prisma/client";
import { requireCurrentUser } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { formatCurrency, formatNumber } from "@/src/lib/pnl";
import {
  formatActiveBrokerLabel,
  formatBrokerAccountLabel,
  getBrokerScopedWhere,
  getWorkspacePreference,
} from "@/src/lib/workspace-preference";

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export default async function DashboardPage() {
  const user = await requireCurrentUser("/dashboard");
  const workspace = await getWorkspacePreference();
  const brokerWhere = getBrokerScopedWhere(workspace.activeBrokerAccountId);
  const closedStatuses = [
    PositionStatus.CLOSED,
    PositionStatus.EXPIRED,
    PositionStatus.ASSIGNED,
    PositionStatus.EXERCISED,
    PositionStatus.CANCELLED,
    PositionStatus.ARCHIVED,
  ];

  const [
    brokerAccountCount,
    recentPositions,
    recentActiveHoldings,
    openPositionCount,
    activeHoldingCount,
    inactiveHoldingCount,
    cashLedgerCount,
    cashLedgerAggregate,
    positionsPnlAggregate,
    holdingsPnlAggregate,
  ] = await Promise.all([
    prisma.brokerAccount.count({
      where: { userId: user.id },
    }),
    prisma.position.findMany({
      where: brokerWhere,
      orderBy: { openedAt: "desc" },
      take: 5,
      include: {
        brokerAccount: {
          include: {
            broker: true,
          },
        },
      },
    }),
    prisma.holding.findMany({
      where: {
        ...brokerWhere,
        remainingQuantity: { gt: 0 },
      },
      orderBy: { openedAt: "desc" },
      take: 4,
      include: {
        brokerAccount: {
          include: {
            broker: true,
          },
        },
        pnlSnapshot: {
          select: {
            currency: true,
            estimatedOpenCost: true,
          },
        },
      },
    }),
    prisma.position.count({
      where: {
        ...brokerWhere,
        currentStatus: {
          notIn: [...closedStatuses],
        },
      },
    }),
    prisma.holding.count({
      where: {
        ...brokerWhere,
        remainingQuantity: { gt: 0 },
      },
    }),
    prisma.holding.count({
      where: {
        ...brokerWhere,
        remainingQuantity: { lte: 0 },
      },
    }),
    prisma.cashLedger.count({
      where: brokerWhere,
    }),
    prisma.cashLedger.aggregate({
      where: brokerWhere,
      _sum: {
        amount: true,
      },
    }),
    prisma.positionPnlSnapshot.aggregate({
      where: {
        ...brokerWhere,
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
      where: brokerWhere,
      _sum: {
        estimatedRealizedPnl: true,
        estimatedCostOfSoldShares: true,
        estimatedOpenCost: true,
      },
    }),
  ]);

  const hasBrokerAccounts = brokerAccountCount > 0;
  const hasActiveBroker = Boolean(workspace.activeBrokerAccountId);
  const needsBrokerSetup = !hasBrokerAccounts || !hasActiveBroker;
  const totalPositionsPnl = Number(positionsPnlAggregate._sum.netCashFlow?.toString() ?? 0);
  const totalPositionsCapital = Number(positionsPnlAggregate._sum.grossDebits?.toString() ?? 0);
  const positionsRoic = totalPositionsCapital > 0 ? (totalPositionsPnl / totalPositionsCapital) * 100 : 0;
  const totalHoldingsPnl = Number(holdingsPnlAggregate._sum.estimatedRealizedPnl?.toString() ?? 0);
  const totalHoldingsCostOfSold = Number(holdingsPnlAggregate._sum.estimatedCostOfSoldShares?.toString() ?? 0);
  const holdingsRoic = totalHoldingsCostOfSold > 0 ? (totalHoldingsPnl / totalHoldingsCostOfSold) * 100 : 0;
  const totalOpenHoldingCost = Number(holdingsPnlAggregate._sum.estimatedOpenCost?.toString() ?? 0);
  const currentCashBalance = Number(cashLedgerAggregate._sum.amount?.toString() ?? 0);
  const dashboardCurrency =
    recentActiveHoldings[0]?.pnlSnapshot?.currency ??
    workspace.activeBrokerAccount?.baseCurrency ??
    "USD";

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h2 className="page-title">Broker-scoped portfolio overview</h2>
            <p className="page-subtitle">
              All portfolio metrics, positions, holdings, and cash activity are scoped to the active broker account selected in the sidebar.
            </p>
            <div className="item-row mt-4">
              <span className="chip-neutral">Active Broker: {formatActiveBrokerLabel(workspace.activeBrokerAccount)}</span>
            </div>
          </div>

          <div className="hero-actions">
            <Link href="/positions/new" className="btn-primary">Create Position</Link>
            <Link href="/broker-accounts" className="btn-secondary">Broker Accounts</Link>
          </div>
        </div>
      </section>

      {needsBrokerSetup ? (
        <section className="panel-strong section-stack">
          <div>
            <p className="eyebrow">Setup Check</p>
            <h3 className="section-heading">
              {!hasBrokerAccounts
                ? "Create your first broker account to unlock the trading workspace."
                : "Choose an active broker account to restore your dashboard context."}
            </h3>
            <p className="section-copy">
              {!hasBrokerAccounts
                ? "Positions, holdings, and cash ledger entries all live under a broker account. Create one first, and optionally seed the opening balance so the dashboard starts with real cash context."
                : "This workspace already has broker accounts, but none is active right now. Pick one in Broker Accounts and the dashboard will scope itself to that account immediately."}
            </p>
          </div>

          <div className="hero-actions">
            <Link href={!hasBrokerAccounts ? "/onboarding" : "/broker-accounts"} className="btn-primary">
              {!hasBrokerAccounts ? "Start Onboarding" : "Select Active Broker"}
            </Link>
            <Link href="/broker-accounts" className="btn-ghost">Broker Accounts</Link>
          </div>
        </section>
      ) : null}

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Portfolio Snapshot</h3>
          <p className="section-copy">A compact account-level view of open workflow, inventory, and cash.</p>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Positions Realized P/L</p>
            <div className="flex items-baseline justify-between gap-3">
              <p className={totalPositionsPnl >= 0 ? "stat-value-positive" : "stat-value-negative"}>
                {formatCurrency(totalPositionsPnl, dashboardCurrency)}
              </p>
              <p className={positionsRoic >= 0 ? "stat-value-positive text-lg" : "stat-value-negative text-lg"}>
                {formatPercent(positionsRoic)}
              </p>
            </div>
          </div>
          <div className="stat-card">
            <p className="stat-label">Holdings Realized P/L</p>
            <div className="flex items-baseline justify-between gap-3">
              <p className={totalHoldingsPnl >= 0 ? "stat-value-positive" : "stat-value-negative"}>
                {formatCurrency(totalHoldingsPnl, dashboardCurrency)}
              </p>
              <p className={holdingsRoic >= 0 ? "stat-value-positive text-lg" : "stat-value-negative text-lg"}>
                {formatPercent(holdingsRoic)}
              </p>
            </div>
          </div>
          <div className="stat-card">
            <p className="stat-label">Open Positions</p>
            <p className="stat-value">{openPositionCount}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Active Holdings</p>
            <p className="stat-value">{activeHoldingCount}</p>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Active Broker Cash</p>
            <p className={currentCashBalance >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {formatCurrency(currentCashBalance, dashboardCurrency)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Open Holding Cost</p>
            <p className="stat-value">{formatCurrency(totalOpenHoldingCost, dashboardCurrency)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Ledger Entries</p>
            <p className="stat-value">{cashLedgerCount}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Inactive Holdings</p>
            <p className="stat-value">{inactiveHoldingCount}</p>
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="panel-strong section-stack">
          <div className="dashboard-section-head">
            <div>
              <h3 className="section-heading">Recent Positions</h3>
              <p className="section-copy">Newest strategies and thesis entries for the active broker account.</p>
            </div>
            <Link href="/positions" className="btn-ghost">All Positions</Link>
          </div>

          {recentPositions.length === 0 ? (
            <div className="empty-state">No positions yet for the active broker account. Create the first one from this dashboard.</div>
          ) : (
            <ul className="list-stack">
              {recentPositions.map((position) => (
                <li key={position.id} className="list-card">
                  <Link href={`/positions/${position.id}`} className="list-link">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h4 className="item-title">{position.underlyingSymbol} · {position.strategyType}</h4>
                        <p className="note mt-2">{position.positionTitle || "Open the position to add title and journal notes."}</p>
                      </div>
                      <div className="item-row">
                        <span className="chip">{position.currentStatus}</span>
                        <span className="chip-neutral">{formatBrokerAccountLabel(position.brokerAccount)}</span>
                        <span className="chip-amber">{new Date(position.openedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="section-stack">
          <div className="panel-strong section-stack">
            <div className="dashboard-section-head">
              <div>
                <h3 className="section-heading">Holdings Monitor</h3>
                <p className="section-copy">Remaining shares and estimated open cost from the active broker inventory.</p>
              </div>
              <Link href="/holdings" className="btn-ghost">All Holdings</Link>
            </div>

            {recentActiveHoldings.length === 0 ? (
              <div className="empty-state">No active holdings right now for the selected broker account.</div>
            ) : (
              <ul className="list-stack">
                {recentActiveHoldings.map((holding) => {
                  const remainingShares = Number(holding.remainingQuantity.toString());
                  const estimatedOpenCost = Number(holding.pnlSnapshot?.estimatedOpenCost?.toString() ?? 0);
                  const pnlCurrency = holding.pnlSnapshot?.currency ?? dashboardCurrency;

                  return (
                    <li key={holding.id} className="list-card">
                      <Link href={`/holdings/${holding.id}`} className="list-link">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="item-title">{holding.symbol}</h4>
                            <p className="note mt-2">{formatNumber(remainingShares)} shares remaining</p>
                            <div className="item-row mt-3">
                              <span className="chip-neutral">{formatBrokerAccountLabel(holding.brokerAccount)}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="meta-label">Open Cost</p>
                            <p className="meta-value">{formatCurrency(estimatedOpenCost, pnlCurrency)}</p>
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="panel-dark section-stack">
            <div>
              <p className="stat-label text-white/70">Workspace Context</p>
              <h3 className="section-heading text-white">Broker-aware trade capture is now in place</h3>
            </div>
            <p className="note text-white/70">
              New positions, manual holdings, and manual cash ledger entries now inherit the active broker account automatically.
            </p>
            <div className="hero-actions">
              <Link href="/broker-accounts" className="btn-ghost border-white/10 bg-white/10 text-white">Review Broker Accounts</Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
