"use client";

import { useState } from "react";

type PositionLegItem = {
  id: string;
  legType: string;
  legSide: string;
  optionType: string | null;
  strikePrice: string | null;
  expiryDate: string;
  quantity: string;
  multiplier: string;
  legRole: string | null;
  legStatus: string;
};

type PositionActionItem = {
  id: string;
  actionType: string;
  actionTimestamp: string;
  amount: string | null;
  feeAmount: string;
  quantity: string | null;
  premiumPerUnit: string | null;
  currency: string;
  resultingStatus: string | null;
  disciplineRating: string;
  notes: string | null;
  locked: boolean;
};

type PositionDetailModalsProps = {
  positionId: string;
  legs: PositionLegItem[];
  actions: PositionActionItem[];
};

export function PositionDetailModals({ positionId, legs, actions }: PositionDetailModalsProps) {
  const [activeModal, setActiveModal] = useState<
    | { kind: "leg"; id: string }
    | { kind: "action"; id: string }
    | null
  >(null);

  const activeLeg = activeModal?.kind === "leg"
    ? legs.find((leg) => leg.id === activeModal.id) ?? null
    : null;

  const activeAction = activeModal?.kind === "action"
    ? actions.find((action) => action.id === activeModal.id) ?? null
    : null

  return (
    <>
      {activeLeg ? (
        <div className="modal-backdrop" role="presentation" style={{ paddingBlock: "1.5rem", overflowY: "auto" }} onMouseDown={(event) => { if (event.target === event.currentTarget) { setActiveModal(null) } }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-leg-title" style={{ maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Manage Leg</p>
                <h3 id="edit-leg-title" className="section-heading">Edit or delete leg</h3>
                <p className="section-copy">Adjust structure without expanding a large inline panel on the page.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setActiveModal(null)}>Close</button>
            </div>

            <form method="POST" action={`/api/positions/${positionId}/legs/${activeLeg.id}`} className="flex min-h-0 flex-1 flex-col">
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
              <input type="hidden" name="intent" value="update" />
                <div className="form-grid">
                  <label className="field-stack">
                    <span className="field-label">Leg Type</span>
                    <select name="legType" defaultValue={activeLeg.legType} className="select-field">
                      <option value="OPTION">Option</option>
                      <option value="STOCK">Stock</option>
                    </select>
                  </label>
                  <label className="field-stack">
                    <span className="field-label">Leg Side</span>
                    <select name="legSide" defaultValue={activeLeg.legSide} className="select-field">
                      <option value="LONG">Long</option>
                      <option value="SHORT">Short</option>
                    </select>
                  </label>
                  <label className="field-stack">
                    <span className="field-label">Option Type</span>
                    <select name="optionType" defaultValue={activeLeg.optionType ?? ""} className="select-field">
                      <option value="">-- None --</option>
                      <option value="CALL">Call</option>
                      <option value="PUT">Put</option>
                    </select>
                  </label>
                  <label className="field-stack">
                    <span className="field-label">Strike Price</span>
                    <input name="strikePrice" type="number" step="0.01" defaultValue={activeLeg.strikePrice ?? ""} className="input-field" />
                  </label>
                  <label className="field-stack">
                    <span className="field-label">Expiry Date</span>
                    <input name="expiryDate" type="date" defaultValue={activeLeg.expiryDate} className="input-field" />
                  </label>
                  <label className="field-stack">
                    <span className="field-label">Quantity</span>
                    <input name="quantity" type="number" step="0.01" defaultValue={activeLeg.quantity} className="input-field" />
                  </label>
                  <label className="field-stack">
                    <span className="field-label">Multiplier</span>
                    <input name="multiplier" type="number" step="1" defaultValue={activeLeg.multiplier} className="input-field" />
                  </label>
                  <label className="field-stack">
                    <span className="field-label">Leg Role</span>
                    <input name="legRole" defaultValue={activeLeg.legRole ?? ""} className="input-field" />
                  </label>
                  <label className="field-stack">
                    <span className="field-label">Leg Status</span>
                    <select name="legStatus" defaultValue={activeLeg.legStatus} className="select-field">
                      <option value="OPEN">Open</option>
                      <option value="PARTIALLY_CLOSED">Partially Closed</option>
                      <option value="CLOSED">Closed</option>
                      <option value="ROLLED">Rolled</option>
                      <option value="ASSIGNED">Assigned</option>
                      <option value="EXPIRED">Expired</option>
                      <option value="EXERCISED">Exercised</option>
                      <option value="REPLACED">Replaced</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
                <button type="button" className="btn-ghost" onClick={() => setActiveModal(null)}>Cancel</button>
                <button type="submit" name="intent" value="update" className="btn-primary">Save Leg Changes</button>
                <button type="submit" name="intent" value="delete" className="btn-ghost">Delete Leg</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {activeAction ? (
        <div className="modal-backdrop" role="presentation" style={{ paddingBlock: "1.5rem", overflowY: "auto" }} onMouseDown={(event) => { if (event.target === event.currentTarget) { setActiveModal(null) } }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-action-title" style={{ maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Manage Action</p>
                <h3 id="edit-action-title" className="section-heading">Edit or delete action</h3>
                <p className="section-copy">Update timeline details in a focused popup instead of a long accordion.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setActiveModal(null)}>Close</button>
            </div>

            {activeAction.locked ? (
              <div className="empty-state">
                Assigned actions are locked here because they may already have created linked holding records.
              </div>
            ) : (
              <form method="POST" action={`/api/positions/${positionId}/actions/${activeAction.id}`} className="flex min-h-0 flex-1 flex-col">
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
                <input type="hidden" name="intent" value="update" />
                  <div className="form-grid">
                    <label className="field-stack">
                      <span className="field-label">Action Type</span>
                      <select name="actionType" defaultValue={activeAction.actionType} className="select-field">
                        <option value="STO">STO</option>
                        <option value="BTC">BTC</option>
                        <option value="BTO">BTO</option>
                        <option value="STC">STC</option>
                        <option value="ROLL_CREDIT">Roll Credit</option>
                        <option value="ROLL_DEBIT">Roll Debit</option>
                        <option value="EXPIRED_WORTHLESS">Expired Worthless</option>
                        <option value="EXERCISED">Exercised</option>
                        <option value="DIVIDEND">Dividend</option>
                        <option value="INTEREST">Interest</option>
                        <option value="FEE">Fee</option>
                        <option value="NOTE">Note</option>
                      </select>
                    </label>
                    <label className="field-stack">
                      <span className="field-label">Action Timestamp</span>
                      <input name="actionTimestamp" type="datetime-local" defaultValue={activeAction.actionTimestamp} className="input-field" />
                    </label>
                    <label className="field-stack">
                      <span className="field-label">Amount</span>
                      <input name="amount" type="number" step="0.01" defaultValue={activeAction.amount ?? ""} className="input-field" />
                    </label>
                    <label className="field-stack">
                      <span className="field-label">Fee Amount</span>
                      <input name="feeAmount" type="number" step="0.01" defaultValue={activeAction.feeAmount} className="input-field" />
                    </label>
                    <label className="field-stack">
                      <span className="field-label">Quantity</span>
                      <input name="quantity" type="number" step="0.01" defaultValue={activeAction.quantity ?? ""} className="input-field" />
                    </label>
                    <label className="field-stack">
                      <span className="field-label">Premium Per Unit</span>
                      <input name="premiumPerUnit" type="number" step="0.01" defaultValue={activeAction.premiumPerUnit ?? ""} className="input-field" />
                    </label>
                    <label className="field-stack">
                      <span className="field-label">Resulting Status</span>
                      <select name="resultingStatus" defaultValue={activeAction.resultingStatus ?? ""} className="select-field">
                        <option value="">-- Auto Detect --</option>
                        <option value="OPEN">Open</option>
                        <option value="PARTIALLY_CLOSED">Partially Closed</option>
                        <option value="CLOSED">Closed</option>
                        <option value="ROLLED">Rolled</option>
                        <option value="ASSIGNED">Assigned</option>
                        <option value="EXPIRED">Expired</option>
                        <option value="EXERCISED">Exercised</option>
                      </select>
                    </label>
                    <label className="field-stack">
                      <span className="field-label">Discipline Rating</span>
                      <select name="disciplineRating" defaultValue={activeAction.disciplineRating} className="select-field">
                        <option value="UNRATED">Unrated</option>
                        <option value="FOLLOWED_PLAN">Followed Plan</option>
                        <option value="ADJUSTED">Adjusted</option>
                        <option value="BROKE_RULES">Broke Rules</option>
                      </select>
                    </label>
                  </div>
                  <label className="field-stack">
                    <span className="field-label">Notes</span>
                    <textarea name="notes" defaultValue={activeAction.notes ?? ""} className="textarea-field min-h-24" rows={3} />
                  </label>
                </div>

                <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
                  <button type="button" className="btn-ghost" onClick={() => setActiveModal(null)}>Cancel</button>
                  <button type="submit" name="intent" value="update" className="btn-primary">Save Action Changes</button>
                  <button type="submit" name="intent" value="delete" className="btn-ghost">Delete Action</button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}

      <div className="hidden">
        {legs.length + actions.length}
      </div>

      <script type="application/json" suppressHydrationWarning>{"[]"}</script>
    </>
  );
}

export function PositionLegModalButton({ legId, onOpen }: { legId: string; onOpen: (id: string) => void }) {
  return <button type="button" className="btn-ghost" onMouseDown={(event) => { if (event.target === event.currentTarget) { onOpen(legId) } }}>Manage Leg</button>;
}

export function PositionActionModalButton({ actionId, onOpen }: { actionId: string; onOpen: (id: string) => void }) {
  return <button type="button" className="btn-ghost" onMouseDown={(event) => { if (event.target === event.currentTarget) { onOpen(actionId) } }}>Manage Action</button>;
}


