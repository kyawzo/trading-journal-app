"use client";

import Link from "next/link";
import { useState } from "react";

type HoldingsPageModalProps = {
  activeBrokerLabel: string;
  defaultOpenedAt: string;
  hasActiveBroker: boolean;
};

export function HoldingsPageModal({
  activeBrokerLabel,
  defaultOpenedAt,
  hasActiveBroker,
}: HoldingsPageModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setIsOpen(true)}>
        Add Manual Holding
      </button>

      {isOpen ? (
        <div className="modal-backdrop" role="presentation" style={{ paddingBlock: "1.5rem", overflowY: "auto" }} onMouseDown={(event) => { if (event.target === event.currentTarget) { setIsOpen(false); } }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-holding-title" style={{ maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">New Holding</p>
                <h3 id="add-holding-title" className="section-heading">Add stock you bought manually or transferred in</h3>
                <p className="section-copy">Create the holding and its opening event together without leaving the holdings page.</p>
                <div className="item-row mt-4">
                  <span className="chip-neutral">Active Broker: {activeBrokerLabel}</span>
                  {!hasActiveBroker ? <span className="chip-amber">Select a broker account first</span> : null}
                </div>
              </div>
              <button type="button" className="modal-close" onClick={() => setIsOpen(false)}>Close</button>
            </div>

            {hasActiveBroker ? (
              <form method="POST" action="/api/holdings" className="flex min-h-0 flex-1 flex-col">
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
                <div className="form-grid">
                  <label className="field-stack"><span className="field-label">Symbol</span><input name="symbol" className="input-field" placeholder="AAPL" required /></label>
                  <label className="field-stack"><span className="field-label">Source Type</span><select name="sourceType" defaultValue="MANUAL_BUY" className="select-field"><option value="MANUAL_BUY">Manual Buy</option><option value="TRANSFER_IN">Transfer In</option><option value="OTHER">Other</option></select></label>
                  <label className="field-stack"><span className="field-label">Opened At</span><input name="openedAt" type="datetime-local" defaultValue={defaultOpenedAt} className="input-field" required /></label>
                  <label className="field-stack"><span className="field-label">Currency</span><select name="currency" defaultValue="USD" className="select-field"><option value="USD">USD</option><option value="SGD">SGD</option></select></label>
                  <label className="field-stack"><span className="field-label">Share Quantity</span><input name="quantity" type="number" step="0.0001" className="input-field" required /></label>
                  <label className="field-stack"><span className="field-label">Cost Basis Per Share</span><input name="costBasisPerShare" type="number" step="0.0001" className="input-field" required /></label>
                  <label className="field-stack"><span className="field-label">Opening Fee</span><input name="feeAmount" type="number" step="0.01" defaultValue="0" className="input-field" /></label>
                </div>

                <label className="field-stack"><span className="field-label">Notes</span><textarea name="notes" rows={3} className="textarea-field min-h-24" placeholder="Manual stock buy, transfer from another broker, long-term core holding..." /></label>

                <p className="note">Manual buys create an <code>ACQUIRED</code> event and post stock cash outflow. <code>TRANSFER_IN</code> creates the holding without cash movement.</p>
                </div>

                <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
                  <button type="button" className="btn-ghost" onClick={() => setIsOpen(false)}>Cancel</button>
                  <button type="submit" className="btn-primary">Create Holding</button>
                </div>
              </form>
            ) : (
              <>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
                  <div className="empty-state">
                    Choose or create an active broker account first. New manual holdings inherit that account automatically so positions, holdings, and cash stay aligned.
                  </div>
                </div>

                <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
                  <button type="button" className="btn-ghost" onClick={() => setIsOpen(false)}>Close</button>
                  <Link href="/broker-accounts" className="btn-secondary" onClick={() => setIsOpen(false)}>
                    Broker Accounts
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
