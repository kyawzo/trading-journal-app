import { NoticeToast } from "@/src/app/components/notice-toast";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PositionDetailLists } from "./position-detail-lists";
import { calculatePositionPnlSummary, formatCurrency } from "@/src/lib/pnl";
import { findOwnedPositionForUser } from "@/src/lib/ownership";
import { requireCurrentUser } from "@/src/lib/auth";
import { formatBrokerAccountLabel } from "@/src/lib/workspace-preference";

type PageProps = {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ notice?: string; tone?: string }>;
};

function formatDateInput(date: Date | null) {
    if (!date) {
        return "";
    }

    return new Date(date).toISOString().split("T")[0];
}

function formatDisplayDate(date: Date | null) {
    if (!date) {
        return null;
    }

    return new Date(date).toLocaleDateString();
}

function formatDateTimeLocalInput(date: Date) {
    const localDate = new Date(date);
    localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
    return localDate.toISOString().slice(0, 16);
}

export default async function PositionDetailPage({ params, searchParams }: PageProps) {
    const { id } = await params;
    const { notice, tone } = await searchParams;

    const user = await requireCurrentUser(`/positions/${id}`);

    const position = await findOwnedPositionForUser(user.id, id, {
        brokerAccount: {
            include: {
                broker: true,
            },
        },
        linkedHolding: {
            include: {
                brokerAccount: {
                    include: {
                        broker: true,
                    },
                },
            },
        },
        legs: true,
        actions: {
            include: {
                actionLegChanges: true,
            },
            orderBy: { actionTimestamp: "asc" },
        },
    });

    if (!position) {
        notFound();
    }

    const pnlSummary = calculatePositionPnlSummary(position.actions);
    const brokerLabel = formatBrokerAccountLabel(position.brokerAccount);

    return (
        <main className="page-shell">
            <NoticeToast notice={notice} tone={tone} />

            <section className="hero-card">
                <div className="hero-grid">
                    <div>
                        <p className="eyebrow">Position Detail</p>
                        <h2 className="page-title font-[var(--font-body)]">
                            {position.underlyingSymbol} · {position.strategyType}
                        </h2>
                        <p className="page-subtitle">
                            Review structure, cash flow, journal context, and execution history for this trade in one screen.
                        </p>
                        <div className="item-row mt-4">
                            <span className="chip">{position.currentStatus}</span>
                            <span className="chip-neutral">{position.assetClass}</span>
                            <span className="chip-neutral">{brokerLabel}</span>
                            <span className="chip-amber">{new Date(position.openedAt).toLocaleDateString()}</span>
                        </div>
                    </div>

                    <div className="hero-actions">
                        <Link href="/positions" className="btn-ghost">Back to Positions</Link>
                        {position.linkedHolding ? (
                            <Link href={`/holdings/${position.linkedHolding.id}`} className="btn-secondary">
                                View Holding
                            </Link>
                        ) : null}
                    </div>
                </div>
            </section>

            <section className="section-stack">
                <div>
                    <h3 className="section-heading">Position PnL Summary</h3>
                    <p className="section-copy">Simple realized cash flow based on recorded position actions.</p>
                </div>

                <div className="stats-grid">
                    <div className="stat-card">
                        <p className="stat-label">Gross Credits</p>
                        <p className="stat-value-positive">{formatCurrency(pnlSummary.grossCredits, pnlSummary.currency)}</p>
                    </div>
                    <div className="stat-card">
                        <p className="stat-label">Gross Debits</p>
                        <p className="stat-value-negative">{formatCurrency(pnlSummary.grossDebits, pnlSummary.currency)}</p>
                    </div>
                    <div className="stat-card">
                        <p className="stat-label">Total Fees</p>
                        <p className="stat-value">{formatCurrency(pnlSummary.totalFees, pnlSummary.currency)}</p>
                    </div>
                    <div className="stat-card">
                        <p className="stat-label">Net Cash Flow</p>
                        <p className={pnlSummary.netCashFlow >= 0 ? "stat-value-positive" : "stat-value-negative"}>
                            {formatCurrency(pnlSummary.netCashFlow, pnlSummary.currency)}
                        </p>
                    </div>
                </div>

                <p className="note">
                    This is a realized cash summary from recorded actions. It does not include live mark-to-market pricing.
                    {pnlSummary.ignoredAmountCount > 0 ? ` ${pnlSummary.ignoredAmountCount} action(s) had amounts that were not classified as a credit or debit yet.` : ""}
                </p>
            </section>

            <section className="panel-strong section-stack">
                <div>
                    <h3 className="section-heading">Position Info</h3>
                    <p className="section-copy">Core setup context and the journal fields you’ve already captured.</p>
                </div>

                <div className="meta-grid">
                    <div className="meta-item"><p className="meta-label">Broker Account</p><p className="meta-value">{brokerLabel}</p></div>
                    <div className="meta-item"><p className="meta-label">Source</p><p className="meta-value">{position.sourceType}</p></div>
                    <div className="meta-item"><p className="meta-label">Asset Class</p><p className="meta-value">{position.assetClass}</p></div>
                    <div className="meta-item"><p className="meta-label">Strategy</p><p className="meta-value">{position.strategyType}</p></div>
                    <div className="meta-item"><p className="meta-label">Symbol</p><p className="meta-value">{position.underlyingSymbol}</p></div>
                    {position.thesis ? <div className="meta-item md:col-span-2"><p className="meta-label">Thesis</p><p className="meta-value">{position.thesis}</p></div> : null}
                    {position.entryPlan ? <div className="meta-item"><p className="meta-label">Entry Plan</p><p className="meta-value">{position.entryPlan}</p></div> : null}
                    {position.exitPlan ? <div className="meta-item"><p className="meta-label">Exit Plan</p><p className="meta-value">{position.exitPlan}</p></div> : null}
                    {position.tradeNotes ? <div className="meta-item md:col-span-2"><p className="meta-label">Notes</p><p className="meta-value">{position.tradeNotes}</p></div> : null}
                </div>
            </section>

            <section className="panel section-stack">
                <div>
                    <h3 className="section-heading">Linked Holding</h3>
                    <p className="section-copy">The stock inventory tied to this position, if applicable.</p>
                </div>

                {position.linkedHolding ? (
                    <div className="meta-grid">
                        <div className="meta-item"><p className="meta-label">Broker Account</p><p className="meta-value">{formatBrokerAccountLabel(position.linkedHolding.brokerAccount)}</p></div>
                        <div className="meta-item"><p className="meta-label">Symbol</p><p className="meta-value">{position.linkedHolding.symbol}</p></div>
                        <div className="meta-item"><p className="meta-label">Status</p><p className="meta-value">{position.linkedHolding.holdingStatus}</p></div>
                        <div className="meta-item"><p className="meta-label">Remaining Shares</p><p className="meta-value">{position.linkedHolding.remainingQuantity.toString()}</p></div>
                        <div className="meta-item"><p className="meta-label">Cost Basis / Share</p><p className="meta-value">{position.linkedHolding.costBasisPerShare.toString()}</p></div>
                    </div>
                ) : (
                    <div className="empty-state">
                        No linked holding yet. An assigned cash-secured put will create one automatically.
                    </div>
                )}
            </section>

            <PositionDetailLists
                positionId={position.id}
                strategyType={position.strategyType}
                legs={position.legs.map((leg) => ({
                    id: leg.id,
                    legType: leg.legType,
                    legSide: leg.legSide,
                    optionType: leg.optionType,
                    strikePrice: leg.strikePrice?.toString() ?? null,
                    expiryDate: formatDateInput(leg.expiryDate),
                    expiryDisplay: formatDisplayDate(leg.expiryDate),
                    quantity: leg.quantity.toString(),
                    multiplier: leg.multiplier.toString(),
                    legRole: leg.legRole,
                    legStatus: leg.legStatus,
                    openedAtDisplay: new Date(leg.openedAt).toLocaleString(),
                    closedAtDisplay: leg.closedAt ? new Date(leg.closedAt).toLocaleString() : null,
                    parentLegId: leg.parentLegId,
                }))}
                journal={{
                    thesis: position.thesis,
                    entryPlan: position.entryPlan,
                    exitPlan: position.exitPlan,
                    tradeNotes: position.tradeNotes,
                }}
                actions={position.actions.map((action) => ({
                    id: action.id,
                    actionType: action.actionType,
                    actionEffect: action.actionEffect,
                    actionTimestampDisplay: new Date(action.actionTimestamp).toLocaleString(),
                    actionTimestampValue: formatDateTimeLocalInput(action.actionTimestamp),
                    amount: action.amount?.toString() ?? null,
                    feeAmount: action.feeAmount.toString(),
                    quantity: action.quantity?.toString() ?? null,
                    premiumPerUnit: action.premiumPerUnit?.toString() ?? null,
                    currency: action.currency,
                    resultingStatus: action.resultingStatus,
                    disciplineRating: action.disciplineRating,
                    notes: action.notes,
                    locked: action.actionType === "ASSIGNED" || action.actionLegChanges.length > 0,
                    lockedReason:
                        action.actionType === "ASSIGNED"
                            ? "Assigned actions are locked here because they may already have created linked holding records."
                            : action.actionLegChanges.length > 0
                                ? "Roll actions that already created replacement leg history cannot be edited or deleted from this UI yet."
                                : null,
                }))}
            />
        </main>
    );
}



