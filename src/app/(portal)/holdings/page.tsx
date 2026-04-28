import { requireCurrentUser } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { formatCurrency, formatNumber } from "@/src/lib/pnl";
import {
  formatActiveBrokerLabel,
  formatBrokerAccountLabel,
  getBrokerScopedWhere,
  getWorkspacePreference,
} from "@/src/lib/workspace-preference";
import { HoldingsListTabs } from "./holdings-list-tabs";
import { HoldingsPageModal } from "./holdings-page-modal";

function formatDateTimeLocalInput(date: Date) {
  const localDate = new Date(date);
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  return localDate.toISOString().slice(0, 16);
}

export default async function HoldingsPage() {
  await requireCurrentUser("/holdings");
  const workspace = await getWorkspacePreference();
  const activeBrokerLabel = formatActiveBrokerLabel(workspace.activeBrokerAccount);
  const hasActiveBroker = Boolean(workspace.activeBrokerAccountId);
  const holdings = await prisma.holding.findMany({
    where: getBrokerScopedWhere(workspace.activeBrokerAccountId),
    orderBy: { openedAt: "desc" },
    take: 50,
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
          effectiveCostBasisPerShare: true,
        },
      },
    },
  });

  const holdingCards = holdings.map((holding) => {
    const remainingQuantityValue = Number(holding.remainingQuantity.toString());
    const estimatedOpenCost = Number(holding.pnlSnapshot?.estimatedOpenCost?.toString() ?? 0);
    const fallbackCostBasisPerShare = Number(holding.costBasisPerShare.toString());
    const avgCostPerShare = remainingQuantityValue > 0
      ? estimatedOpenCost / remainingQuantityValue
      : Number(holding.pnlSnapshot?.effectiveCostBasisPerShare?.toString() ?? fallbackCostBasisPerShare);
    const summaryCurrency = holding.pnlSnapshot?.currency ?? holding.brokerAccount?.baseCurrency ?? "USD";

    return {
      id: holding.id,
      symbol: holding.symbol,
      remainingQuantityLabel: formatNumber(remainingQuantityValue),
      remainingQuantityValue,
      holdingStatus: holding.holdingStatus,
      sourceType: holding.sourceType,
      brokerLabel: formatBrokerAccountLabel(holding.brokerAccount),
      openedAtDisplay: new Date(holding.openedAt).toLocaleDateString(),
      openCostDisplay: formatCurrency(estimatedOpenCost, summaryCurrency),
      avgCostDisplay: formatCurrency(avgCostPerShare, summaryCurrency),
    };
  });

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Holdings</p>
            <h2 className="page-title">See the stock layer behind each broker account.</h2>
            <p className="page-subtitle">
              Follow assigned shares, manual stock entries, linked covered calls, event history, and holding-level cost snapshots for the active broker.
            </p>
            <div className="item-row mt-4">
              <span className="chip-neutral">Active Broker: {activeBrokerLabel}</span>
            </div>
          </div>

          <div className="hero-actions">
            <HoldingsPageModal
              activeBrokerLabel={activeBrokerLabel}
              defaultOpenedAt={formatDateTimeLocalInput(new Date())}
              hasActiveBroker={hasActiveBroker}
            />
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Current Holdings</h3>
          <p className="section-copy">Track active stock inventory separately from holdings that are already closed or archived.</p>
        </div>

        {holdingCards.length === 0 ? (
          <div className="empty-state">
            No holdings yet for this broker account. Create one manually or let assigned positions create holdings automatically.
          </div>
        ) : (
          <HoldingsListTabs holdings={holdingCards} />
        )}
      </section>
    </main>
  );
}
