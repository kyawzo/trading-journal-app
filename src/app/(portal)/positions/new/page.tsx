import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/src/lib/auth";
import { findOwnedHoldingForUser } from "@/src/lib/ownership";
import { formatActiveBrokerLabel, getWorkspacePreference } from "@/src/lib/workspace-preference";

type PageProps = {
  searchParams: Promise<{
    symbol?: string;
    strategy?: string;
    linkedHoldingId?: string;
    notice?: string;
    tone?: string;
  }>;
};

export default async function NewPositionPage({ searchParams }: PageProps) {
  const { symbol, strategy, linkedHoldingId, notice, tone } = await searchParams;
  const user = await requireCurrentUser("/positions/new");
  const workspace = await getWorkspacePreference();

  const linkedHolding = linkedHoldingId
    ? await findOwnedHoldingForUser(user.id, linkedHoldingId)
    : null;

  if (linkedHoldingId && !linkedHolding) {
    notFound();
  }

  if (
    linkedHolding &&
    workspace.activeBrokerAccountId &&
    linkedHolding.brokerAccountId !== workspace.activeBrokerAccountId
  ) {
    notFound();
  }

  const hasActiveBroker = Boolean(workspace.activeBrokerAccountId);

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">New Position</p>
            <h2 className="page-title">Open a fresh strategy entry inside the active broker account.</h2>
            <p className="page-subtitle">
              Use this for manual trades or start a covered call from an existing holding with the broker context preserved automatically.
            </p>
            <div className="item-row mt-4">
              <span className="chip-neutral">Active Broker: {formatActiveBrokerLabel(workspace.activeBrokerAccount)}</span>
              {!hasActiveBroker ? <span className="chip-amber">Select a broker account first</span> : null}
            </div>
          </div>

          <div className="hero-actions">
            <Link href="/positions" className="btn-ghost">Back to Positions</Link>
            {!hasActiveBroker ? <Link href="/broker-accounts" className="btn-secondary">Broker Accounts</Link> : null}
          </div>
        </div>
      </section>

      {notice ? (
        <section className={tone === "error" ? "alert-error static !w-auto !shadow-sm" : "alert-success static !w-auto !shadow-sm"}>
          {notice}
        </section>
      ) : null}

      {linkedHolding ? (
        <section className="panel-dark">
          <p className="eyebrow !text-white/60">Covered Call Source</p>
          <h3 className="mt-3 text-2xl font-semibold">{linkedHolding.symbol}</h3>
          <div className="item-row mt-4">
            <span className="chip-amber">{linkedHolding.remainingQuantity.toString()} shares available</span>
            <span className="chip-neutral">{linkedHolding.holdingStatus}</span>
          </div>
          <p className="mt-4 text-sm text-white/70">
            Cost basis per share: {linkedHolding.costBasisPerShare.toString()}
          </p>
        </section>
      ) : null}

      <section className="panel-strong">
        <div className="mb-5">
          <h3 className="section-heading">Position Setup</h3>
          <p className="section-copy">Keep this lightweight for now. You can add legs, actions, and journal notes after creation.</p>
        </div>

        {hasActiveBroker ? (
          <form method="POST" action="/api/positions" className="space-y-4">
            {linkedHolding ? <input type="hidden" name="linkedHoldingId" value={linkedHolding.id} /> : null}

            <div className="form-grid">
              <input
                name="symbol"
                placeholder="Symbol (e.g. SPX, NVDA)"
                className="input-field"
                defaultValue={linkedHolding?.symbol ?? symbol ?? ""}
              />

              <select
                name="strategy"
                className="select-field"
                defaultValue={linkedHolding ? "CC" : strategy ?? "IRON_CONDOR"}
              >
                <option value="IRON_CONDOR">Iron Condor</option>
                <option value="BULL_PUT_SPREAD">Bull Put Spread</option>
                <option value="BEAR_PUT_SPREAD">Bear Put Spread</option>
                <option value="BULL_CALL_SPREAD">Bull Call Spread</option>
                <option value="BEAR_CALL_SPREAD">Bear Call Spread</option>
                <option value="CSP">Cash Secured Put</option>
                <option value="CC">Covered Call</option>
                <option value="LONG_CALL">Long Call</option>
                <option value="LONG_PUT">Long Put</option>
                <option value="LEAPS_CALL">LEAPS Call</option>
                <option value="LEAPS_PUT">LEAPS Put</option>
                <option value="SHORT_CALL">Short Call</option>
                <option value="SHORT_PUT">Short Put</option>
                <option value="STOCK_LONG">Long Stock</option>
                <option value="STOCK_SHORT">Short Stock</option>
              </select>
            </div>

            <div className="hero-actions">
              <button className="btn-primary">Create Position</button>
            </div>
          </form>
        ) : (
          <div className="empty-state">
            Choose or create an active broker account first. New positions inherit that account automatically so you do not have to select the broker every time.
          </div>
        )}
      </section>
    </main>
  );
}


