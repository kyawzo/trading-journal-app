"use client";

import { useMemo, useState } from "react";

type RollableLegItem = {
  id: string;
  label: string;
  legShape: string;
  strikePrice: string | null;
  expiryDisplay: string | null;
  quantity: string;
  multiplier: string;
};

type PositionRollModalProps = {
  positionId: string;
  strategyType: string;
  legs: RollableLegItem[];
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field-stack">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function formatDateTimeLocalInput(date: Date) {
  const localDate = new Date(date);
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  return localDate.toISOString().slice(0, 16);
}

export function PositionRollModal({ positionId, strategyType, legs }: PositionRollModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [actionType, setActionType] = useState("ROLL_CREDIT");
  const [selectedLegIds, setSelectedLegIds] = useState<string[]>(() => legs.map((leg) => leg.id));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const defaultQuantity = legs[0]?.quantity ?? "1";
  const defaultMultiplier = legs[0]?.multiplier ?? "100";

  const selectedLegSet = useMemo(() => new Set(selectedLegIds), [selectedLegIds]);

  function toggleLeg(legId: string) {
    setSelectedLegIds((current) =>
      current.includes(legId) ? current.filter((id) => id !== legId) : [...current, legId]
    );
  }

  function openModal() {
    setSelectedLegIds(legs.map((leg) => leg.id));
    setActionType("ROLL_CREDIT");
    setError(null);
    setIsOpen(true);
  }

  async function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch(`/api/positions/${positionId}/roll`, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        window.location.href = `/positions/${positionId}`;
        return;
      }

      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        const data = await response.json();
        setError(data.error || "An error occurred. Please try again.");
      } else {
        const text = await response.text();
        const url = new URL(response.url || window.location.href);
        const notice = url.searchParams.get("notice");
        setError(notice || "An error occurred. Please try again.");
      }
    } catch (err) {
      setError("Failed to submit form. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  }


  if (legs.length === 0) {
    return null;
  }

  return (
    <>
      <button type="button" className="btn-secondary" onClick={openModal}>Roll Legs</button>

      {isOpen ? (
        <div className="modal-backdrop" role="presentation" style={{ paddingBlock: "1.5rem", overflowY: "auto" }} onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setIsOpen(false);
          }
        }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="roll-legs-title" onWheel={(event) => event.stopPropagation()} style={{ maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Roll Legs</p>
                <h3 id="roll-legs-title" className="section-heading">Create replacement contracts and preserve leg history</h3>
                <p className="section-copy">
                  Select the live option legs you want to roll, record the net credit or debit, and the app will mark the old legs as rolled and create new replacement legs under the same position.
                </p>
              </div>
              <button type="button" className="modal-close" onClick={() => setIsOpen(false)}>Close</button>
            </div>

            <form onSubmit={handleFormSubmit} className="flex min-h-0 flex-1 flex-col">
              {error ? (
                <div className="alert-error">
                  <span>{error}</span>
                </div>
              ) : null}
              
              <div className="space-y-5" style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }}>
              <div className="meta-item">
                <p className="meta-label">Strategy Context</p>
                <p className="meta-value">{strategyType}. Select one side only for partial rolls, or all live legs for a full structure roll.</p>
              </div>

              <div className="form-grid">
                <Field label="Roll Type">
                  <select name="actionType" className="select-field" value={actionType} onChange={(event) => setActionType(event.target.value)}>
                    <option value="ROLL_CREDIT">Roll Credit</option>
                    <option value="ROLL_DEBIT">Roll Debit</option>
                  </select>
                </Field>
                <Field label="Roll Timestamp">
                  <input name="actionTimestamp" type="datetime-local" className="input-field" defaultValue={formatDateTimeLocalInput(new Date())} required />
                </Field>
                <Field label="Premium">
                  <input name="premium" type="number" step="0.01" className="input-field" />
                </Field>
                <Field label="Quantity">
                  <input name="quantity" type="number" step="0.01" className="input-field" defaultValue={defaultQuantity} />
                </Field>
                <Field label="Fee Amount">
                  <input name="feeAmount" type="number" step="0.01" className="input-field" defaultValue="0" />
                </Field>
                <Field label="Currency">
                  <select name="currency" className="select-field" defaultValue="USD">
                    <option value="USD">USD</option>
                    <option value="SGD">SGD</option>
                  </select>
                </Field>
                <Field label="Resulting Status">
                  <select name="resultingStatus" className="select-field" defaultValue="OPEN">
                    <option value="OPEN">Open</option>
                    <option value="PARTIALLY_CLOSED">Partially Closed</option>
                    <option value="ROLLED">Rolled</option>
                    <option value="CLOSED">Closed</option>
                  </select>
                </Field>
                <Field label="Discipline Rating">
                  <select name="disciplineRating" className="select-field" defaultValue="UNRATED">
                    <option value="UNRATED">Unrated</option>
                    <option value="FOLLOWED_PLAN">Followed Plan</option>
                    <option value="ADJUSTED">Adjusted</option>
                    <option value="BROKE_RULES">Broke Rules</option>
                  </select>
                </Field>
                <Field label="New Expiry Date">
                  <input name="newExpiryDate" type="date" className="input-field" required />
                </Field>
                <Field label="Replacement Quantity">
                  <input name="newQuantity" type="number" step="0.01" className="input-field" defaultValue={defaultQuantity} />
                </Field>
                <Field label="Replacement Multiplier">
                  <input name="newMultiplier" type="number" step="1" className="input-field" defaultValue={defaultMultiplier} />
                </Field>
              </div>

              <Field label="Roll Notes">
                <textarea name="notes" className="textarea-field min-h-24" rows={3} placeholder="Example: Rolled tested put side out 14 days for a net credit after SPX touched the short put." />
              </Field>

              <div className="space-y-3">
                <div>
                  <h4 className="section-heading">Select Legs To Roll</h4>
                  <p className="section-copy">Each selected leg will be marked as <code>ROLLED</code> and replaced by a new open contract.</p>
                </div>

                <div className="list-stack">
                  {legs.map((leg) => (
                    <div key={leg.id} className="list-card space-y-4">
                      <input type="hidden" name="selectedLegIds" value={selectedLegSet.has(leg.id) ? leg.id : ""} disabled={!selectedLegSet.has(leg.id)} />
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <label className="inline-flex items-start gap-3 text-sm text-[var(--ink-2)]">
                          <input
                            type="checkbox"
                            checked={selectedLegSet.has(leg.id)}
                            onChange={() => toggleLeg(leg.id)}
                            className="mt-1 h-4 w-4 accent-[var(--teal)]"
                          />
                          <span>
                            <span className="font-semibold">{leg.label}</span>
                            <span className="block text-[var(--ink-3)]">{leg.legShape}</span>
                            <span className="block text-[var(--ink-3)]">Current strike {leg.strikePrice ?? "-"} · Expiry {leg.expiryDisplay ?? "-"}</span>
                          </span>
                        </label>

                        <div className="event-metric-grid !grid-cols-2 !gap-2 lg:!w-[20rem]">
                          <div className="event-metric-card"><p className="event-metric-label">Qty</p><p className="event-metric-value">{leg.quantity}</p></div>
                          <div className="event-metric-card"><p className="event-metric-label">Multiplier</p><p className="event-metric-value">{leg.multiplier}</p></div>
                        </div>
                      </div>

                      {selectedLegSet.has(leg.id) ? (
                        <Field label={`Replacement Strike for ${leg.label}`}>
                          <input name={`strike_${leg.id}`} type="number" step="0.01" className="input-field" defaultValue={leg.strikePrice ?? ""} required />
                        </Field>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              </div>

              <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
                <button type="button" className="btn-ghost" onClick={() => setIsOpen(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? "Creating Roll..." : "Create Roll"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}




