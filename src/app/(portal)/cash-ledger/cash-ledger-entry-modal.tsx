"use client";

import Link from "next/link";
import { useState } from "react";

type CashLedgerEntryModalProps = {
  activeBrokerLabel: string;
  defaultTimestamp: string;
  hasActiveBroker: boolean;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field-stack">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function CashLedgerEntryModal({
  activeBrokerLabel,
  defaultTimestamp,
  hasActiveBroker,
}: CashLedgerEntryModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setIsOpen(true)}>
        Add Cash Entry
      </button>

      {isOpen ? (
        <div className="modal-backdrop" role="presentation" style={{ paddingBlock: "1.5rem", overflowY: "auto" }} onMouseDown={(event) => { if (event.target === event.currentTarget) { setIsOpen(false); } }}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-cash-entry-title"
            style={{ maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Cash Ledger</p>
                <h3 id="add-cash-entry-title" className="section-heading">
                  Add cash movement without leaving the ledger
                </h3>
                <p className="section-copy">
                  Use this for opening balance, transfers, manual adjustments, dividends, interest, and broker-side cash charges.
                </p>
                <div className="item-row mt-4">
                  <span className="chip-neutral">Active Broker: {activeBrokerLabel}</span>
                  {!hasActiveBroker ? <span className="chip-amber">Select a broker account first</span> : null}
                </div>
              </div>
              <button type="button" className="modal-close" onClick={() => setIsOpen(false)}>
                Close
              </button>
            </div>

            {hasActiveBroker ? (
              <form method="POST" action="/api/cash-ledger" className="flex min-h-0 flex-1 flex-col">
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
                <div className="form-grid">
                  <Field label="Transaction Type">
                    <select name="txnType" defaultValue="DEPOSIT" className="select-field">
                      <option value="DEPOSIT">Deposit</option>
                      <option value="WITHDRAWAL">Withdrawal</option>
                      <option value="ADJUSTMENT">Adjustment</option>
                      <option value="DIVIDEND">Dividend</option>
                      <option value="INTEREST">Interest</option>
                      <option value="FEE">Fee</option>
                      <option value="COMMISSION">Commission</option>
                      <option value="TAX">Tax</option>
                      <option value="TRANSFER_IN">Transfer In</option>
                      <option value="TRANSFER_OUT">Transfer Out</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </Field>
                  <Field label="Transaction Time">
                    <input name="txnTimestamp" type="datetime-local" defaultValue={defaultTimestamp} className="input-field" />
                  </Field>
                  <Field label="Amount">
                    <input name="amount" type="number" step="0.01" className="input-field" required />
                  </Field>
                  <Field label="Currency">
                    <select name="currency" defaultValue="USD" className="select-field">
                      <option value="USD">USD</option>
                      <option value="SGD">SGD</option>
                    </select>
                  </Field>
                </div>

                <Field label="Description">
                  <textarea
                    name="description"
                    className="textarea-field min-h-24"
                    rows={3}
                    placeholder="Opening balance, broker top-up, tax adjustment, dividend received..."
                  />
                </Field>

                <p className="note">
                  Enter a positive number for deposits, withdrawals, fees, and taxes. The ledger will apply the correct sign automatically.
                  Use <code>ADJUSTMENT</code> or <code>OTHER</code> only when you intentionally need a positive or negative custom correction.
                </p>
                </div>

                <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
                  <button type="button" className="btn-ghost" onClick={() => setIsOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">Save Cash Entry</button>
                </div>
              </form>
            ) : (
              <>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
                  <div className="empty-state">
                    Choose or create an active broker account first. Manual cash entries inherit that account automatically so each ledger row stays broker-scoped.
                  </div>
                </div>

                <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
                  <button type="button" className="btn-ghost" onClick={() => setIsOpen(false)}>
                    Close
                  </button>
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
