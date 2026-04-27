"use client";

import { FormEvent, useState } from "react";

type BrokerOption = {
  value: string;
  label: string;
};

const BROKER_OPTIONS: BrokerOption[] = [
  { value: "MOOMOO", label: "MooMoo" },
  { value: "TIGER", label: "Tiger" },
  { value: "IBKR", label: "Interactive Brokers" },
  { value: "TASTYTRADE", label: "tastytrade" },
  { value: "WEBULL", label: "Webull" },
  { value: "MANUAL", label: "Manual Broker" },
];

export function BrokerAccountModal({ defaultOpenedAt }: { defaultOpenedAt: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const brokerCode = (form.elements.namedItem("brokerCode") as HTMLSelectElement)?.value;
    const accountName = (form.elements.namedItem("accountName") as HTMLInputElement)?.value.trim();
    const nextErrors: string[] = [];

    if (!brokerCode) {
      nextErrors.push("Broker is required.");
    }

    if (!accountName) {
      nextErrors.push("Account Name is required.");
    }

    if (nextErrors.length > 0) {
      event.preventDefault();
      setErrors(nextErrors);
    }
  }

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setIsOpen(true)}>
        Create Broker Account
      </button>

      {isOpen ? (
        <div className="modal-backdrop" role="presentation" style={{ paddingBlock: "1.5rem", overflowY: "auto" }} onMouseDown={(event) => { if (event.target === event.currentTarget) { setIsOpen(false); } }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-broker-account-title" style={{ maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">New Broker Account</p>
                <h3 id="add-broker-account-title" className="section-heading">Add a broker account to scope your trades and cash.</h3>
                <p className="section-copy">Create the account once, then use it as the active broker for positions, holdings, and cash ledger entries.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setIsOpen(false)}>
                Close
              </button>
            </div>

            <form method="POST" action="/api/broker-accounts" className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
              {errors.length > 0 ? (
                <div className="alert-error">
                  <p className="font-semibold">Please fix the following issues</p>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="form-grid">
                <label className="field-stack">
                  <span className="field-label">Broker</span>
                  <select name="brokerCode" className="select-field" defaultValue="" required>
                    <option value="" disabled hidden>Select broker</option>
                    {BROKER_OPTIONS.map((broker) => (
                      <option key={broker.value} value={broker.value}>{broker.label}</option>
                    ))}
                  </select>
                </label>

                <label className="field-stack">
                  <span className="field-label">Account Name</span>
                  <input name="accountName" className="input-field" placeholder="MooMoo Main" required />
                </label>

                <label className="field-stack">
                  <span className="field-label">Account Type</span>
                  <select name="accountType" className="select-field" defaultValue="MARGIN">
                    <option value="CASH">CASH</option>
                    <option value="MARGIN">MARGIN</option>
                    <option value="PAPER">PAPER</option>
                    <option value="RETIREMENT">RETIREMENT</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </label>

                <label className="field-stack">
                  <span className="field-label">Base Currency</span>
                  <select name="baseCurrency" className="select-field" defaultValue="USD">
                    <option value="USD">USD</option>
                    <option value="SGD">SGD</option>
                  </select>
                </label>

                <label className="field-stack">
                  <span className="field-label">Masked Account Number</span>
                  <input name="accountNumberMasked" className="input-field" placeholder="••••1234" />
                </label>

                <label className="field-stack">
                  <span className="field-label">Opened At</span>
                  <input name="openedAt" type="date" className="input-field" defaultValue={defaultOpenedAt} />
                </label>
              </div>

              <label className="field-stack">
                <span className="field-label">Opening Balance</span>
                <input name="openingBalance" type="number" step="0.01" min="0" className="input-field" placeholder="Optional starting cash" />
              </label>

              <label className="field-stack">
                <span className="field-label">Notes</span>
                <textarea name="notes" rows={3} className="textarea-field min-h-24" placeholder="Margin account, wheel account, test account, long-term portfolio..." />
              </label>

              <label className="note inline-flex items-center gap-2">
                <input type="checkbox" name="setAsActive" defaultChecked={false} />
                Set this as the active broker account now
              </label>

              <p className="note">If you enter an opening balance, the app will save it as the first <strong>DEPOSIT</strong> ledger entry for this account. New positions, holdings, and cash entries can then inherit this broker context automatically.</p>
              </div>

              <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
                <button type="button" className="btn-ghost" onClick={() => setIsOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">Create Broker Account</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

