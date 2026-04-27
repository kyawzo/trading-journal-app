"use client";

import { useState } from "react";

type HoldingEventItem = {
  id: string;
  eventType: string;
  eventTimestampDisplay: string;
  eventTimestampValue: string;
  quantity: string | null;
  pricePerShare: string | null;
  amount: string | null;
  feeAmount: string;
  currency: string;
  notes: string | null;
  positionActionType: string | null;
  locked: boolean;
};

type HoldingEventListProps = {
  holdingId: string;
  events: HoldingEventItem[];
};

export function HoldingEventList({ holdingId, events }: HoldingEventListProps) {
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const activeEvent = activeEventId ? events.find((event) => event.id === activeEventId) ?? null : null;

  return (
    <>
      {activeEvent ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setActiveEventId(null) } }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-holding-event-title">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Manage Holding Event</p>
                <h3 id="edit-holding-event-title" className="section-heading">Edit or delete holding event</h3>
                <p className="section-copy">Keep the stock event timeline editable without using a long inline expander.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setActiveEventId(null)}>Close</button>
            </div>

            {activeEvent.locked ? (
              <div className="empty-state">
                Events linked to a position action are locked here because they were created by another workflow.
              </div>
            ) : (
              <div className="space-y-4">
                <form id="holding-event-update-form" method="POST" action={`/api/holdings/${holdingId}/events/${activeEvent.id}`} className="space-y-4">
                  <input type="hidden" name="intent" value="update" />
                  <div className="form-grid">
                    <label className="field-stack"><span className="field-label">Event Type</span><select name="eventType" defaultValue={activeEvent.eventType} className="select-field"><option value="SOLD">Sold</option><option value="PARTIAL_SELL">Partial Sell</option><option value="CALLED_AWAY">Called Away</option><option value="DIVIDEND">Dividend</option><option value="ADJUSTMENT">Adjustment</option><option value="NOTE">Note</option><option value="TRANSFER_OUT">Transfer Out</option><option value="TRANSFER_IN">Transfer In</option><option value="ACQUIRED">Acquired</option></select></label>
                    <label className="field-stack"><span className="field-label">Event Time</span><input name="eventTimestamp" type="datetime-local" defaultValue={activeEvent.eventTimestampValue} className="input-field" required /></label>
                    <label className="field-stack"><span className="field-label">Quantity</span><input name="quantity" type="number" step="0.0001" defaultValue={activeEvent.quantity ?? ""} className="input-field" /></label>
                    <label className="field-stack"><span className="field-label">Price Per Share</span><input name="pricePerShare" type="number" step="0.0001" defaultValue={activeEvent.pricePerShare ?? ""} className="input-field" /></label>
                    <label className="field-stack"><span className="field-label">Fee Amount</span><input name="feeAmount" type="number" step="0.01" defaultValue={activeEvent.feeAmount} className="input-field" /></label>
                    <label className="field-stack"><span className="field-label">Currency</span><select name="currency" defaultValue={activeEvent.currency} className="select-field"><option value="USD">USD</option><option value="SGD">SGD</option></select></label>
                  </div>
                  <label className="field-stack"><span className="field-label">Notes</span><textarea name="notes" rows={3} defaultValue={activeEvent.notes ?? ""} className="textarea-field min-h-24" /></label>
                </form>

                <div className="modal-actions">
                  <button type="button" className="btn-ghost" onClick={() => setActiveEventId(null)}>Cancel</button>
                  <form method="POST" action={`/api/holdings/${holdingId}/events/${activeEvent.id}`}>
                    <input type="hidden" name="intent" value="delete" />
                    <button className="btn-ghost">Delete Holding Event</button>
                  </form>
                  <button form="holding-event-update-form" className="btn-primary">Save Event Changes</button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Holding Events</h3>
          <p className="section-copy">A running event ledger for acquisitions, sales, and stock-level changes.</p>
        </div>

        {events.length === 0 ? (
          <div className="empty-state">No holding events yet.</div>
        ) : (
          <ul className="list-stack">
            {events.map((event) => (
              <li key={event.id} className="list-card space-y-4">
                <div className="event-headline">
                  <div>
                    <h4 className="item-title">{event.eventType}</h4>
                    <p className="event-timestamp">{event.eventTimestampDisplay}</p>
                  </div>
                  <div className="hero-actions">
                    <div className="item-row !mt-0">
                      <span className="chip-neutral">{event.currency}</span>
                      {event.positionActionType ? <span className="chip">{event.positionActionType}</span> : null}
                    </div>
                    <button type="button" className="btn-ghost" onClick={() => setActiveEventId(event.id)}>Manage Event</button>
                  </div>
                </div>

                <div className="event-metric-grid">
                  {event.quantity !== null ? <div className="event-metric-card"><p className="event-metric-label">Quantity</p><p className="event-metric-value">{event.quantity}</p></div> : null}
                  {event.pricePerShare !== null ? <div className="event-metric-card"><p className="event-metric-label">Price / Share</p><p className="event-metric-value">{event.pricePerShare}</p></div> : null}
                  {event.amount !== null ? <div className="event-metric-card"><p className="event-metric-label">Amount</p><p className="event-metric-value">{event.amount} {event.currency}</p></div> : null}
                  <div className="event-metric-card"><p className="event-metric-label">Fee</p><p className="event-metric-value">{event.feeAmount} {event.currency}</p></div>
                </div>

                {event.notes ? <p className="note">{event.notes}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

