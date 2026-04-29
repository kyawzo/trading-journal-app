"use client";

import { useState } from "react";

type HoldingDetailModalsProps = {
  holdingId: string;
  symbol: string;
  sourceType: string;
  openedAtValue: string;
  costBasisPerShare: string;
  notes: string;
  hasPositionLinks: boolean;
  canArchive: boolean;
  canAddEvents: boolean;
  defaultEventTimestamp: string;
};

export function HoldingDetailModals({
  holdingId,
  symbol,
  sourceType,
  openedAtValue,
  costBasisPerShare,
  notes,
  hasPositionLinks,
  canArchive,
  canAddEvents,
  defaultEventTimestamp,
}: HoldingDetailModalsProps) {
  const [activeModal, setActiveModal] = useState<"manage" | "archive" | "event" | null>(null);

  return (
    <>
      <div className="hero-actions">
        <button type="button" className="btn-primary" disabled={!canAddEvents} onClick={() => setActiveModal("event")}>
          Add Holding Event
        </button>
        <button type="button" className="btn-secondary" onClick={() => setActiveModal("manage")}>
          Manage Holding
        </button>
        <button type="button" className="btn-ghost" onClick={() => setActiveModal("archive")}>
          Archive Holding
        </button>
      </div>

      {activeModal === "event" && canAddEvents ? (
        <div className="modal-backdrop" role="presentation" style={{ paddingBlock: "1.5rem", overflowY: "auto" }} onMouseDown={(event) => { if (event.target === event.currentTarget) { setActiveModal(null) } }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-holding-event-title" style={{ maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Add Holding Event</p>
                <h3 id="add-holding-event-title" className="section-heading">Record a stock-level event</h3>
                <p className="section-copy">Add sales, dividends, called-away exits, or adjustments without pushing the event timeline down the page.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setActiveModal(null)} aria-label="Close add holding event modal">
                Close
              </button>
            </div>

            <form method="POST" action={`/api/holdings/${holdingId}/events`} className="flex min-h-0 flex-1 flex-col">
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
              <div className="form-grid">
                <label className="field-stack"><span className="field-label">Event Type</span><select name="eventType" defaultValue="SOLD" className="select-field"><option value="SOLD">Sold</option><option value="PARTIAL_SELL">Partial Sell</option><option value="CALLED_AWAY">Called Away</option><option value="DIVIDEND">Dividend</option><option value="ADJUSTMENT">Adjustment</option><option value="NOTE">Note</option><option value="TRANSFER_OUT">Transfer Out</option><option value="TRANSFER_IN">Transfer In</option><option value="ACQUIRED">Acquired</option></select></label>
                <label className="field-stack"><span className="field-label">Event Time</span><input name="eventTimestamp" type="datetime-local" defaultValue={defaultEventTimestamp} className="input-field" required /></label>
                <label className="field-stack"><span className="field-label">Quantity</span><input name="quantity" type="number" step="0.0001" className="input-field" /></label>
                <label className="field-stack"><span className="field-label">Price Per Share</span><input name="pricePerShare" type="number" step="0.0001" className="input-field" /></label>
                <label className="field-stack"><span className="field-label">Fee Amount</span><input name="feeAmount" type="number" step="0.01" defaultValue="0" className="input-field" /></label>
              </div>

              <label className="field-stack"><span className="field-label">Notes</span><textarea name="notes" rows={3} className="textarea-field min-h-24" placeholder="Partial stock sale, called away by short call, dividend received, manual share adjustment..." /></label>

              <p className="note">For price-based stock events, total amount is calculated automatically from quantity x price per share. <code>ACQUIRED</code> posts stock cash outflow, sell and called-away events post stock cash inflow, and <code>TRANSFER_IN</code> / <code>TRANSFER_OUT</code> only affect inventory. Currency follows broker account base currency.</p>
              </div>

              <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
                <button type="button" className="btn-ghost" onClick={() => setActiveModal(null)}>Cancel</button>
                <button type="submit" className="btn-primary">Add Holding Event</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {activeModal === "manage" ? (
        <div className="modal-backdrop" role="presentation" style={{ paddingBlock: "1.5rem", overflowY: "auto" }} onMouseDown={(event) => { if (event.target === event.currentTarget) { setActiveModal(null) } }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="manage-holding-title" style={{ maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Manage Holding</p>
                <h3 id="manage-holding-title" className="section-heading">Update holding metadata</h3>
                <p className="section-copy">Keep the stock record tidy without pushing the event workflow further down the page.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setActiveModal(null)} aria-label="Close manage holding modal">
                Close
              </button>
            </div>

            <form method="POST" action={`/api/holdings/${holdingId}`} className="flex min-h-0 flex-1 flex-col">
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
              <input type="hidden" name="intent" value="update" />
              <div className="form-grid">
                <label className="field-stack">
                  <span className="field-label">Symbol</span>
                  <input name="symbol" defaultValue={symbol} className="input-field" disabled={hasPositionLinks} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Source Type</span>
                  <select name="sourceType" defaultValue={sourceType} className="select-field">
                    <option value="MANUAL_BUY">Manual Buy</option>
                    <option value="TRANSFER_IN">Transfer In</option>
                    <option value="OTHER">Other</option>
                    <option value="ASSIGNED_FROM_PUT">Assigned from Put</option>
                    <option value="EXERCISED_FROM_CALL">Exercised from Call</option>
                    <option value="CORPORATE_ACTION">Corporate Action</option>
                  </select>
                </label>
                <label className="field-stack">
                  <span className="field-label">Opened At</span>
                  <input name="openedAt" type="datetime-local" defaultValue={openedAtValue} className="input-field" />
                </label>
                <label className="field-stack">
                  <span className="field-label">Cost Basis Per Share</span>
                  <input name="costBasisPerShare" type="number" step="0.0001" defaultValue={costBasisPerShare} className="input-field" />
                </label>
              </div>

              <label className="field-stack">
                <span className="field-label">Notes</span>
                <textarea name="notes" rows={3} defaultValue={notes} className="textarea-field min-h-24" />
              </label>

              {hasPositionLinks ? (
                <p className="note">Symbol changes are locked because this holding is already linked to one or more positions.</p>
              ) : null}
              </div>

              <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
                <button type="button" className="btn-ghost" onClick={() => setActiveModal(null)}>Cancel</button>
                <button type="submit" className="btn-secondary">Save Holding Changes</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {activeModal === "archive" ? (
        <div className="modal-backdrop" role="presentation" style={{ paddingBlock: "1.5rem", overflowY: "auto" }} onMouseDown={(event) => { if (event.target === event.currentTarget) { setActiveModal(null) } }}>
          <div className="modal-card modal-card-sm" role="dialog" aria-modal="true" aria-labelledby="archive-holding-title" style={{ maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Archive Holding</p>
                <h3 id="archive-holding-title" className="section-heading">Archive this holding?</h3>
                <p className="section-copy">This is available only after remaining shares reach zero and linked positions are cleared.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setActiveModal(null)} aria-label="Close archive holding modal">
                Close
              </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
              <div className="empty-state">
                Archive keeps the record for history, but moves it out of the active holding workflow.
              </div>

              {!canArchive ? (
                <p className="note">Archive is disabled because this holding still has remaining shares or active linked positions.</p>
              ) : null}
            </div>

            <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
              <button type="button" className="btn-ghost" onClick={() => setActiveModal(null)}>Cancel</button>
              <form method="POST" action={`/api/holdings/${holdingId}`}>
                <input type="hidden" name="intent" value="archive" />
                <button type="submit" className="btn-secondary" disabled={!canArchive}>Confirm Archive</button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
