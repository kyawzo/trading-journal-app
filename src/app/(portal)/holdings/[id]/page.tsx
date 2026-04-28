import { NoticeToast } from "@/src/app/components/notice-toast";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HoldingDetailModals } from "./holding-detail-modals";
import { HoldingEventList } from "./holding-event-list";
import { formatCurrency, formatNumber } from "@/src/lib/pnl";
import { findOwnedHoldingForUser } from "@/src/lib/ownership";
import { requireCurrentUser } from "@/src/lib/auth";
import { formatBrokerAccountLabel } from "@/src/lib/workspace-preference";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; tone?: string }>;
};

function formatDateTimeLocalInput(date: Date) {
  const localDate = new Date(date);
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  return localDate.toISOString().slice(0, 16);
}

export default async function HoldingDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { notice, tone } = await searchParams;

  const user = await requireCurrentUser(`/holdings/${id}`);

  const holding = await findOwnedHoldingForUser(user.id, id, {
    brokerAccount: {
      include: {
        broker: true,
      },
    },
    linkedPosition: {
      include: {
        brokerAccount: {
          include: {
            broker: true,
          },
        },
      },
    },
    linkedFromPositions: {
      include: {
        brokerAccount: {
          include: {
            broker: true,
          },
        },
      },
      orderBy: { openedAt: "desc" },
    },
    holdingEvents: {
      include: {
        positionAction: true,
      },
      orderBy: { eventTimestamp: "desc" },
    },
    pnlSnapshot: true,
  });

  if (!holding) {
    notFound();
  }

  const remainingQuantityValue = Number(holding.remainingQuantity.toString());
  const hasPositionLinks = Boolean(holding.linkedPosition) || holding.linkedFromPositions.length > 0;
  const canArchive = remainingQuantityValue <= 0 && holding.linkedFromPositions.length === 0;
  const isHoldingInactive = holding.holdingStatus === "ARCHIVED" || remainingQuantityValue <= 0;
  const brokerLabel = formatBrokerAccountLabel(holding.brokerAccount);
  const pnlSummary = {
    currency: holding.pnlSnapshot?.currency ?? holding.brokerAccount?.baseCurrency ?? "USD",
    acquiredShares: Number(holding.pnlSnapshot?.acquiredShares?.toString() ?? 0),
    soldShares: Number(holding.pnlSnapshot?.soldShares?.toString() ?? 0),
    grossPurchaseCost: Number(holding.pnlSnapshot?.grossPurchaseCost?.toString() ?? 0),
    grossSaleProceeds: Number(holding.pnlSnapshot?.grossSaleProceeds?.toString() ?? 0),
    totalFees: Number(holding.pnlSnapshot?.totalFees?.toString() ?? 0),
    estimatedRealizedPnl: Number(holding.pnlSnapshot?.estimatedRealizedPnl?.toString() ?? 0),
    estimatedOpenCost: Number(holding.pnlSnapshot?.estimatedOpenCost?.toString() ?? 0),
  };

  return (
    <main className="page-shell">
      <NoticeToast notice={notice} tone={tone} />

      <section className="hero-card">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Holding Detail</p>
            <h2 className="page-title font-[var(--font-body)]">{holding.symbol} Holding</h2>
            <p className="page-subtitle">
              Follow stock inventory, linked positions, event history, and estimated realized results from the holding side.
            </p>
            <div className="item-row mt-4">
              <span className="chip">{holding.holdingStatus}</span>
              <span className="chip-neutral">{holding.sourceType}</span>
              <span className="chip-neutral">{brokerLabel}</span>
              <span className="chip-amber">{new Date(holding.openedAt).toLocaleDateString()}</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="hero-actions">
              {isHoldingInactive ? (
                <button type="button" className="btn-primary" disabled>
                  Create Covered Call
                </button>
              ) : (
                <Link
                  href={`/positions/new?strategy=CC&symbol=${encodeURIComponent(holding.symbol)}&linkedHoldingId=${holding.id}`}
                  className="btn-primary"
                >
                  Create Covered Call
                </Link>
              )}
              <Link href="/holdings" className="btn-ghost">Back to Holdings</Link>
            </div>

            {isHoldingInactive ? (
              <p className="note">Covered calls and new holding events are disabled after this holding is archived or its remaining shares reach zero.</p>
            ) : null}

            <HoldingDetailModals
              holdingId={holding.id}
              symbol={holding.symbol}
              sourceType={holding.sourceType}
              openedAtValue={formatDateTimeLocalInput(holding.openedAt)}
              costBasisPerShare={holding.costBasisPerShare.toString()}
              notes={holding.notes ?? ""}
              hasPositionLinks={hasPositionLinks}
              canArchive={canArchive}
              canAddEvents={!isHoldingInactive}
              defaultEventTimestamp={formatDateTimeLocalInput(new Date())}
            />
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Holding PnL Summary</h3>
          <p className="section-copy">Estimated from the cached holding snapshot so detail screens stay fast even when event history grows.</p>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Acquired Shares</p>
            <p className="stat-value">{formatNumber(pnlSummary.acquiredShares)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Sold Shares</p>
            <p className="stat-value">{formatNumber(pnlSummary.soldShares)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Estimated Realized PnL</p>
            <p className={pnlSummary.estimatedRealizedPnl >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {formatCurrency(pnlSummary.estimatedRealizedPnl, pnlSummary.currency)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Estimated Open Cost</p>
            <p className="stat-value">{formatCurrency(pnlSummary.estimatedOpenCost, pnlSummary.currency)}</p>
          </div>
        </div>

        <div className="stats-grid-3">
          <div className="stat-card">
            <p className="stat-label">Gross Purchase Cost</p>
            <p className="stat-value">{formatCurrency(pnlSummary.grossPurchaseCost, pnlSummary.currency)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Gross Sale Proceeds</p>
            <p className="stat-value">{formatCurrency(pnlSummary.grossSaleProceeds, pnlSummary.currency)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Total Fees</p>
            <p className="stat-value">{formatCurrency(pnlSummary.totalFees, pnlSummary.currency)}</p>
          </div>
        </div>

        <p className="note">
          Snapshot values are refreshed whenever holding events change. They are still estimate-based and not tax-lot accounting.
        </p>
      </section>

      <section className="panel-strong section-stack">
        <div>
          <h3 className="section-heading">Holding Info</h3>
          <p className="section-copy">Core metadata for the stock inventory layer.</p>
        </div>

        <div className="meta-grid">
          <div className="meta-item"><p className="meta-label">Broker Account</p><p className="meta-value">{brokerLabel}</p></div>
          <div className="meta-item"><p className="meta-label">Symbol</p><p className="meta-value">{holding.symbol}</p></div>
          <div className="meta-item"><p className="meta-label">Source Type</p><p className="meta-value">{holding.sourceType}</p></div>
          <div className="meta-item"><p className="meta-label">Total Quantity</p><p className="meta-value">{holding.quantity.toString()}</p></div>
          <div className="meta-item"><p className="meta-label">Open Quantity</p><p className="meta-value">{holding.openQuantity.toString()}</p></div>
          <div className="meta-item"><p className="meta-label">Remaining Quantity</p><p className="meta-value">{holding.remainingQuantity.toString()}</p></div>
          <div className="meta-item"><p className="meta-label">Cost Basis / Share</p><p className="meta-value">{holding.costBasisPerShare.toString()}</p></div>
          {holding.closedAt ? <div className="meta-item"><p className="meta-label">Closed At</p><p className="meta-value">{new Date(holding.closedAt).toLocaleString()}</p></div> : null}
          {holding.notes ? <div className="meta-item md:col-span-2"><p className="meta-label">Notes</p><p className="meta-value">{holding.notes}</p></div> : null}
        </div>
      </section>

      <section className="panel section-stack">
        <div>
          <h3 className="section-heading">Linked Position</h3>
          <p className="section-copy">The originating position, if this holding was created from one.</p>
        </div>

        {holding.linkedPosition ? (
          <div className="list-card">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h4 className="item-title">{holding.linkedPosition.underlyingSymbol} · {holding.linkedPosition.strategyType}</h4>
                <p className="note mt-2">Position Status: {holding.linkedPosition.currentStatus}</p>
                <div className="item-row mt-3">
                  <span className="chip-neutral">{formatBrokerAccountLabel(holding.linkedPosition.brokerAccount)}</span>
                </div>
              </div>
              <div className="hero-actions">
                <Link href={`/positions/${holding.linkedPosition.id}`} className="btn-secondary">View Position</Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-state">This holding is not linked to a position.</div>
        )}
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Positions Using This Holding</h3>
          <p className="section-copy">Strategies that depend on this share inventory, including covered calls.</p>
        </div>

        {holding.linkedFromPositions.length === 0 ? (
          <div className="empty-state">No positions are linked to this holding yet.</div>
        ) : (
          <ul className="list-stack">
            {holding.linkedFromPositions.map((position) => (
              <li key={position.id} className="list-card">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h4 className="item-title">{position.underlyingSymbol} · {position.strategyType}</h4>
                    <p className="note mt-2">Status: {position.currentStatus}</p>
                    <div className="item-row mt-3">
                      <span className="chip-neutral">{formatBrokerAccountLabel(position.brokerAccount)}</span>
                    </div>
                  </div>
                  <div className="hero-actions">
                    <Link href={`/positions/${position.id}`} className="btn-ghost">View Position</Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <HoldingEventList
        holdingId={holding.id}
        events={holding.holdingEvents.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          eventTimestampDisplay: new Date(event.eventTimestamp).toLocaleString(),
          eventTimestampValue: formatDateTimeLocalInput(event.eventTimestamp),
          quantity: event.quantity?.toString() ?? null,
          pricePerShare: event.pricePerShare?.toString() ?? null,
          amount: event.amount?.toString() ?? null,
          feeAmount: event.feeAmount.toString(),
          currency: event.currency,
          notes: event.notes,
          positionActionType: event.positionAction?.actionType ?? null,
          locked: Boolean(event.linkedPositionActionId),
        }))}
      />
    </main>
  );
}


