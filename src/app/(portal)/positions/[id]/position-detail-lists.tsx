"use client";

import { useState } from "react";
import { getPositionStrategyLegTemplate, supportsGroupedLegEditing } from "@/src/lib/position-leg-templates";
import { PositionActionForm, PositionLegForm } from "./position-detail-forms";
import { PositionRollModal } from "./position-roll-modal";

type PositionLegItem = {
  id: string;
  legType: string;
  legSide: string;
  optionType: string | null;
  strikePrice: string | null;
  expiryDate: string;
  expiryDisplay: string | null;
  quantity: string;
  multiplier: string;
  legRole: string | null;
  legStatus: string;
  openedAtDisplay: string;
  closedAtDisplay: string | null;
  parentLegId: string | null;
};

type PositionActionItem = {
  id: string;
  actionType: string;
  actionEffect: string;
  actionTimestampDisplay: string;
  actionTimestampValue: string;
  amount: string | null;
  feeAmount: string;
  quantity: string | null;
  premiumPerUnit: string | null;
  currency: string;
  resultingStatus: string | null;
  disciplineRating: string;
  notes: string | null;
  locked: boolean;
  lockedReason: string | null;
};

type PositionJournalItem = {
  thesis: string | null;
  entryPlan: string | null;
  exitPlan: string | null;
  tradeNotes: string | null;
};

type PositionDetailListsProps = {
  positionId: string;
  strategyType: string;
  legs: PositionLegItem[];
  actions: PositionActionItem[];
  journal: PositionJournalItem;
};

function formatLegShape(leg: PositionLegItem) {
  return [leg.legSide, leg.optionType, leg.legType].filter(Boolean).join(" ");
}

function orderStructuredLegs(legs: PositionLegItem[], strategyType: string) {
  const template = getPositionStrategyLegTemplate(strategyType);

  if (!template) {
    return legs;
  }

  const roleOrder = new Map(template.legs.map((leg, index) => [leg.legRole, index]));

  return [...legs].sort((a, b) => {
    const aIndex = roleOrder.get(a.legRole ?? "") ?? Number.MAX_SAFE_INTEGER;
    const bIndex = roleOrder.get(b.legRole ?? "") ?? Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });
}

const OPTION_PREMIUM_ACTION_TYPES = new Set(["STO", "BTO", "BTC", "STC", "ROLL_CREDIT", "ROLL_DEBIT"]);
const ACTION_TYPE_OPTIONS = [
  { value: "STO", label: "STO (Sell to Open)" },
  { value: "BTO", label: "BTO (Buy to Open)" },
  { value: "BTC", label: "BTC (Buy to Close)" },
  { value: "STC", label: "STC (Sell to Close)" },
  { value: "ROLL_CREDIT", label: "ROLL_CREDIT (Net Credit)" },
  { value: "ROLL_DEBIT", label: "ROLL_DEBIT (Net Debit)" },
  { value: "EXPIRED_WORTHLESS", label: "EXPIRED_WORTHLESS" },
  { value: "EXERCISED", label: "EXERCISED" },
  { value: "DIVIDEND", label: "DIVIDEND" },
  { value: "INTEREST", label: "INTEREST" },
  { value: "FEE", label: "FEE" },
  { value: "NOTE", label: "NOTE" },
] as const;

function isActiveLegStatus(status: string | null | undefined) {
  return status === "OPEN" || status === "PARTIALLY_CLOSED";
}

function usesPremiumQuote(actionType: string) {
  return OPTION_PREMIUM_ACTION_TYPES.has(actionType);
}

function getActionTypeLabel(actionType: string) {
  return ACTION_TYPE_OPTIONS.find((action) => action.value === actionType)?.label ?? actionType;
}

function getActionTypeGuidance(actionType: string) {
  switch (actionType) {
    case "STO":
      return "Adds premium cash when you are opening a short option position.";
    case "BTO":
      return "Spends premium cash when you are opening a long option position.";
    case "BTC":
      return "Spends premium cash to close a short option position.";
    case "STC":
      return "Brings premium cash back in when closing a long option position.";
    case "ROLL_CREDIT":
      return "Use when the replacement trade gives you a net credit.";
    case "ROLL_DEBIT":
      return "Use when the replacement trade costs you a net debit.";
    default:
      return "Choose the action that matches the real broker-side execution before saving.";
  }
}

function renderLegMetricCard(label: string, value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return (
    <div className="event-metric-card">
      <p className="event-metric-label">{label}</p>
      <p className="event-metric-value">{value}</p>
    </div>
  );
}

function getStrategySummary(strategyType: string, legs: PositionLegItem[]) {
  switch (strategyType) {
    case "IRON_CONDOR":
      return "IC: long put wing | short put | short call | long call wing";
    case "BULL_PUT_SPREAD":
      return "BPS: short put + long put protection";
    case "BEAR_CALL_SPREAD":
      return "BCS: short call + long call protection";
    case "BULL_CALL_SPREAD":
      return "Bull call spread: long call + short call";
    case "BEAR_PUT_SPREAD":
      return "Bear put spread: long put + short put";
    case "CSP":
      return "CSP: one short put contract backed by cash";
    case "CC":
      return "CC: one short call contract against held shares";
    case "LONG_CALL":
      return "Long call: single bullish call contract";
    case "LONG_PUT":
      return "Long put: single bearish put contract";
    case "SHORT_CALL":
      return "Short call: single uncovered call contract";
    case "SHORT_PUT":
      return "Short put: single put sold for premium";
    case "LEAPS_CALL":
      return "LEAPS call: long-dated bullish call contract";
    case "LEAPS_PUT":
      return "LEAPS put: long-dated bearish put contract";
    case "STOCK_LONG":
      return "Long stock: share position without option legs";
    case "STOCK_SHORT":
      return "Short stock: borrowed share position";
    default:
      return legs.map((leg) => leg.legRole ?? formatLegShape(leg)).join(" | ");
  }
}

function getJournalSummary(journal: PositionJournalItem) {
  if (journal.thesis) {
    return journal.thesis;
  }

  if (journal.tradeNotes) {
    return journal.tradeNotes;
  }

  if (journal.entryPlan || journal.exitPlan) {
    return "Entry and exit plans captured for this trade.";
  }

  return "No journal notes captured yet. Add your trade thesis, plan, and review notes here.";
}

export function PositionDetailLists({ positionId, strategyType, legs, actions, journal }: PositionDetailListsProps) {
  const [activeModal, setActiveModal] = useState<
    | { kind: "create-leg" }
    | { kind: "create-action" }
    | { kind: "leg"; id: string }
    | { kind: "action"; id: string }
    | { kind: "journal" }
    | null
  >(null);
  const [activeActionType, setActiveActionType] = useState<string | null>(null);

  const legTemplate = getPositionStrategyLegTemplate(strategyType);
  const allowSharedLegEditing = supportsGroupedLegEditing(strategyType);
  const activeLegs = legs.filter((leg) => isActiveLegStatus(leg.legStatus));
  const historicalLegs = legs.filter((leg) => !isActiveLegStatus(leg.legStatus));
  const rollableLegs = activeLegs.filter((leg) => leg.legType === "OPTION");
  const structuredLegs = orderStructuredLegs(activeLegs, strategyType);
  const sharedExpiry = structuredLegs.length > 0 ? structuredLegs[0]?.expiryDisplay ?? null : null;
  const sharedQuantity = structuredLegs.length > 0 ? structuredLegs[0]?.quantity ?? null : null;
  const sharedMultiplier = structuredLegs.length > 0 ? structuredLegs[0]?.multiplier ?? null : null;

  const activeLeg = activeModal?.kind === "leg"
    ? legs.find((leg) => leg.id === activeModal.id) ?? null
    : null;

  const activeAction = activeModal?.kind === "action"
    ? actions.find((action) => action.id === activeModal.id) ?? null
    : null;
  const resolvedActiveActionType = activeActionType ?? activeAction?.actionType ?? null;
  const activeActionUsesPremium = resolvedActiveActionType ? usesPremiumQuote(resolvedActiveActionType) : false;

  return (
    <>
      {activeModal?.kind === "create-leg" ? (
        <div className="modal-backdrop" role="presentation" style={{ paddingBlock: "1.5rem", overflowY: "auto" }} onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setActiveModal(null);
          }
        }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-leg-title" style={{ maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Add Leg</p>
                <h3 id="create-leg-title" className="section-heading">
                  {legTemplate ? `Generate ${legTemplate.label} structure` : "Add a new position leg"}
                </h3>
                <p className="section-copy">
                  {legTemplate
                    ? "Build the legs incrementally or skip ahead with pre-made strategy structures."
                    : "Create structure in a focused popup instead of pushing the whole detail page downward."}
                </p>
              </div>
              <button type="button" className="modal-close" onClick={() => setActiveModal(null)}>Close</button>
            </div>
            <PositionLegForm positionId={positionId} strategyType={strategyType} existingLegCount={legs.length} />
          </div>
        </div>
      ) : null}

      {activeModal?.kind === "create-action" ? (
        <div className="modal-backdrop" role="presentation" style={{ paddingBlock: "1.5rem", overflowY: "auto" }} onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setActiveModal(null);
          }
        }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-action-title" style={{ maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Add Action</p>
                <h3 id="create-action-title" className="section-heading">Add a new trade action</h3>
                <p className="section-copy">Capture premium, closes, income, notes, and the real action timestamp without interrupting the rest of the page layout.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => { setActiveActionType(null); setActiveModal(null); }}>Close</button>
            </div>
            <PositionActionForm positionId={positionId} />
          </div>
        </div>
      ) : null}

      {activeModal?.kind === "journal" ? (
        <div className="modal-backdrop" role="presentation" style={{ paddingBlock: "1.5rem", overflowY: "auto" }} onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setActiveModal(null);
          }
        }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="journal-notes-title" style={{ maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Journal Notes</p>
                <h3 id="journal-notes-title" className="section-heading">Capture the why behind the trade</h3>
                <p className="section-copy">Keep thesis, entry plan, exit plan, and trade review in the same popup flow as the rest of the position tools.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setActiveModal(null)}>Close</button>
            </div>

            <form method="POST" action={`/api/positions/${positionId}/journal`} className="flex min-h-0 flex-1 flex-col">
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
              <label className="field-stack">
                <span className="field-label">Thesis</span>
                <textarea name="thesis" defaultValue={journal.thesis ?? ""} className="textarea-field min-h-28" rows={3} placeholder="Why did you enter this trade?" />
              </label>

              <div className="form-grid">
                <label className="field-stack">
                  <span className="field-label">Entry Plan</span>
                  <textarea name="entryPlan" defaultValue={journal.entryPlan ?? ""} className="textarea-field min-h-24" rows={2} placeholder="Entry plan" />
                </label>
                <label className="field-stack">
                  <span className="field-label">Exit Plan</span>
                  <textarea name="exitPlan" defaultValue={journal.exitPlan ?? ""} className="textarea-field min-h-24" rows={2} placeholder="Exit plan" />
                </label>
              </div>

              <label className="field-stack">
                <span className="field-label">Trade Notes</span>
                <textarea name="tradeNotes" defaultValue={journal.tradeNotes ?? ""} className="textarea-field min-h-28" rows={3} placeholder="Reflection / notes" />
              </label>
              </div>

              <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
                <button type="button" className="btn-ghost" onClick={() => setActiveModal(null)}>Cancel</button>
                <button type="submit" className="btn-secondary">Save Journal</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {activeLeg ? (
        <div className="modal-backdrop" role="presentation" style={{ paddingBlock: "1.5rem", overflowY: "auto" }} onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setActiveModal(null);
          }
        }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-leg-title" style={{ maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Manage Leg</p>
                <h3 id="edit-leg-title" className="section-heading">Edit or delete leg</h3>
                <p className="section-copy">
                  {legTemplate
                    ? "Keep the strategy shape intact while adjusting the values that actually change trade to trade."
                    : "Adjust position structure without opening a large inline section."}
                </p>
              </div>
              <button type="button" className="modal-close" onClick={() => setActiveModal(null)}>Close</button>
            </div>

            <form method="POST" action={`/api/positions/${positionId}/legs/${activeLeg.id}`} className="flex min-h-0 flex-1 flex-col">
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
              <input type="hidden" name="intent" value="update" />
                {legTemplate ? (
                  <>
                    <input type="hidden" name="legType" value={activeLeg.legType} />
                    <input type="hidden" name="legSide" value={activeLeg.legSide} />
                    <input type="hidden" name="optionType" value={activeLeg.optionType ?? ""} />
                    <input type="hidden" name="legRole" value={activeLeg.legRole ?? ""} />

                    <div className="meta-grid">
                      <div className="meta-item"><p className="meta-label">Strategy</p><p className="meta-value">{legTemplate.label}</p></div>
                      <div className="meta-item"><p className="meta-label">Leg Shape</p><p className="meta-value">{formatLegShape(activeLeg)}</p></div>
                      {activeLeg.legRole ? <div className="meta-item"><p className="meta-label">Leg Role</p><p className="meta-value">{activeLeg.legRole}</p></div> : null}
                      <div className="meta-item"><p className="meta-label">Current Status</p><p className="meta-value">{activeLeg.legStatus}</p></div>
                    </div>

                    <div className="form-grid">
                      <label className="field-stack"><span className="field-label">Strike Price</span><input name="strikePrice" type="number" step="0.01" defaultValue={activeLeg.strikePrice ?? ""} className="input-field" /></label>
                      <label className="field-stack"><span className="field-label">Expiry Date</span><input name="expiryDate" type="date" defaultValue={activeLeg.expiryDate} className="input-field" /></label>
                      <label className="field-stack"><span className="field-label">Quantity</span><input name="quantity" type="number" step="0.01" defaultValue={activeLeg.quantity} className="input-field" /></label>
                      <label className="field-stack"><span className="field-label">Multiplier</span><input name="multiplier" type="number" step="1" defaultValue={activeLeg.multiplier} className="input-field" /></label>
                      <label className="field-stack"><span className="field-label">Leg Status</span><select name="legStatus" defaultValue={activeLeg.legStatus} className="select-field"><option value="OPEN">OPEN</option><option value="PARTIALLY_CLOSED">PARTIALLY_CLOSED</option><option value="CLOSED">CLOSED</option><option value="ROLLED">ROLLED</option><option value="ASSIGNED">ASSIGNED</option><option value="EXPIRED">EXPIRED</option><option value="EXERCISED">EXERCISED</option><option value="REPLACED">REPLACED</option></select></label>
                    </div>

                    {allowSharedLegEditing ? (
                      <label className="field-stack">
                        <span className="field-label">Shared Strategy Update</span>
                        <label className="inline-flex items-center gap-3 rounded-full border border-sand-200 bg-white/80 px-4 py-3 text-sm text-sand-700">
                          <input type="checkbox" name="applySharedFields" className="h-4 w-4 accent-[var(--accent-strong)]" />
                          Apply quantity, multiplier, and expiry to sibling legs in this strategy too
                        </label>
                      </label>
                    ) : null}
                  </>
                ) : (
                  <div className="form-grid">
                    <label className="field-stack"><span className="field-label">Leg Type</span><select name="legType" defaultValue={activeLeg.legType} className="select-field"><option value="OPTION">OPTION</option><option value="STOCK">STOCK</option></select></label>
                    <label className="field-stack"><span className="field-label">Leg Side</span><select name="legSide" defaultValue={activeLeg.legSide} className="select-field"><option value="LONG">LONG</option><option value="SHORT">SHORT</option></select></label>
                    <label className="field-stack"><span className="field-label">Option Type</span><select name="optionType" defaultValue={activeLeg.optionType ?? ""} className="select-field"><option value="">-- None --</option><option value="CALL">CALL</option><option value="PUT">PUT</option></select></label>
                    <label className="field-stack"><span className="field-label">Strike Price</span><input name="strikePrice" type="number" step="0.01" defaultValue={activeLeg.strikePrice ?? ""} className="input-field" /></label>
                    <label className="field-stack"><span className="field-label">Expiry Date</span><input name="expiryDate" type="date" defaultValue={activeLeg.expiryDate} className="input-field" /></label>
                    <label className="field-stack"><span className="field-label">Quantity</span><input name="quantity" type="number" step="0.01" defaultValue={activeLeg.quantity} className="input-field" /></label>
                    <label className="field-stack"><span className="field-label">Multiplier</span><input name="multiplier" type="number" step="1" defaultValue={activeLeg.multiplier} className="input-field" /></label>
                    <label className="field-stack"><span className="field-label">Leg Role</span><input name="legRole" defaultValue={activeLeg.legRole ?? ""} className="input-field" /></label>
                    <label className="field-stack"><span className="field-label">Leg Status</span><select name="legStatus" defaultValue={activeLeg.legStatus} className="select-field"><option value="OPEN">OPEN</option><option value="PARTIALLY_CLOSED">PARTIALLY_CLOSED</option><option value="CLOSED">CLOSED</option><option value="ROLLED">ROLLED</option><option value="ASSIGNED">ASSIGNED</option><option value="EXPIRED">EXPIRED</option><option value="EXERCISED">EXERCISED</option><option value="REPLACED">REPLACED</option></select></label>
                  </div>
                )}
                <div className="modal-actions pt-6">
                  <button type="button" className="btn-ghost" onClick={() => setActiveModal(null)}>Cancel</button>
                  <button type="submit" name="intent" value="update" className="btn-primary">Save Leg Changes</button>
                  <button type="submit" name="intent" value="delete" className="btn-ghost">Delete Leg</button>
                </div>
              </div>
              </form>
          </div>
        </div>
      ) : null}
      {activeAction ? (
        <div className="modal-backdrop" role="presentation" style={{ paddingBlock: "1.5rem", overflowY: "auto" }} onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setActiveActionType(null);
            setActiveModal(null);
          }
        }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-action-title" style={{ maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Manage Action</p>
                <h3 id="edit-action-title" className="section-heading">Edit or delete action</h3>
                <p className="section-copy">Keep the trade timeline editable without opening long inline forms.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => { setActiveActionType(null); setActiveModal(null); }}>Close</button>
            </div>

            {activeAction.locked ? (
              <div className="empty-state">{activeAction.lockedReason ?? "This action is locked here because it already created linked records."}</div>
            ) : (
              <form method="POST" action={`/api/positions/${positionId}/actions/${activeAction.id}`} className="flex min-h-0 flex-1 flex-col">
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
                <input type="hidden" name="intent" value="update" />
                <div className="form-grid">
                  <label className="field-stack"><span className="field-label">Action Type</span><select name="actionType" value={resolvedActiveActionType ?? activeAction.actionType} onChange={(event) => setActiveActionType(event.target.value)} className="select-field">{ACTION_TYPE_OPTIONS.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}</select></label>
                  <div className="meta-item md:col-span-2">
                    <p className="meta-label">Current Action</p>
                    <p className="meta-value">{getActionTypeLabel(resolvedActiveActionType ?? activeAction.actionType)}</p>
                    <p className="note mt-2">{getActionTypeGuidance(resolvedActiveActionType ?? activeAction.actionType)}</p>
                  </div>
                  <label className="field-stack"><span className="field-label">Action Timestamp</span><input name="actionTimestamp" type="datetime-local" defaultValue={activeAction.actionTimestampValue} className="input-field" /></label>
                  {!activeActionUsesPremium ? <label className="field-stack"><span className="field-label">Amount</span><input name="amount" type="number" step="0.01" defaultValue={activeAction.amount ?? ""} className="input-field" /></label> : null}
                  <label className="field-stack"><span className="field-label">Fee Amount</span><input name="feeAmount" type="number" step="0.01" defaultValue={activeAction.feeAmount} className="input-field" /></label>
                  <label className="field-stack"><span className="field-label">Quantity</span><input name="quantity" type="number" step="0.01" defaultValue={activeAction.quantity ?? ""} className="input-field" /></label>
                  {activeActionUsesPremium ? <label className="field-stack"><span className="field-label">Premium</span><input name="premium" type="number" step="0.01" defaultValue={activeAction.premiumPerUnit ?? activeAction.amount ?? ""} className="input-field" /></label> : null}
                  <label className="field-stack"><span className="field-label">Resulting Status</span><select name="resultingStatus" defaultValue={activeAction.resultingStatus ?? ""} className="select-field"><option value="">-- Auto Detect --</option><option value="OPEN">OPEN</option><option value="PARTIALLY_CLOSED">PARTIALLY_CLOSED</option><option value="CLOSED">CLOSED</option><option value="ROLLED">ROLLED</option><option value="ASSIGNED">ASSIGNED</option><option value="EXPIRED">EXPIRED</option><option value="EXERCISED">EXERCISED</option></select></label>
                  <label className="field-stack"><span className="field-label">Discipline Rating</span><select name="disciplineRating" defaultValue={activeAction.disciplineRating} className="select-field"><option value="UNRATED">UNRATED</option><option value="FOLLOWED_PLAN">FOLLOWED_PLAN</option><option value="ADJUSTED">ADJUSTED</option><option value="BROKE_RULES">BROKE_RULES</option></select></label>
                </div>
                  <label className="field-stack"><span className="field-label">Notes</span><textarea name="notes" defaultValue={activeAction.notes ?? ""} className="textarea-field min-h-24" rows={3} /></label>
                </div>

                <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
                  <button type="button" className="btn-ghost" onClick={() => { setActiveActionType(null); setActiveModal(null); }}>Cancel</button>
                  <button type="submit" name="intent" value="update" className="btn-primary">Save Action Changes</button>
                  <button type="submit" name="intent" value="delete" className="btn-ghost">Delete Action</button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}

      <section className="section-stack">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="section-heading">Legs</h3>
            <p className="section-copy">
              {legTemplate && activeLegs.length === 0 && legs.length === 0
                ? `This ${legTemplate.label} can generate its full structure in one step.`
                : legTemplate && activeLegs.length > 0
                  ? `Live contracts are shown first, with rolled or closed leg history captured below.`
                  : "Structure the position one leg at a time."}
            </p>
          </div>
          <div className="hero-actions">
            {!legTemplate || legs.length === 0 ? (
              <button type="button" className="btn-accent" onClick={() => setActiveModal({ kind: "create-leg" })}>
                {legTemplate ? "Create Strategy" : "Add Leg"}
              </button>
            ) : null}
            <PositionRollModal
              positionId={positionId}
              strategyType={strategyType}
              legs={rollableLegs.map((leg) => ({
                id: leg.id,
                label: leg.legRole ?? formatLegShape(leg),
                legShape: formatLegShape(leg),
                strikePrice: leg.strikePrice,
                expiryDisplay: leg.expiryDisplay,
                quantity: leg.quantity,
                multiplier: leg.multiplier,
              }))}
            />
          </div>
        </div>

        {activeLegs.length === 0 ? (
          <div className="empty-state">No active legs right now. Historical leg records are shown below if this position was previously active.</div>
        ) : legTemplate ? (
          <div className="list-card space-y-5">
            <div className="event-headline">
              <div>
                <h4 className="item-title">{legTemplate.label}</h4>
                <p className="event-timestamp">{structuredLegs.length} active leg(s) in the current live structure</p>
                <p className="note mt-2">{getStrategySummary(strategyType, structuredLegs)}</p>
              </div>
              <div className="item-row !mt-0">
                {renderLegMetricCard("Expiry", sharedExpiry)}
                {renderLegMetricCard("Qty", sharedQuantity)}
                {renderLegMetricCard("Multiplier", sharedMultiplier)}
              </div>
            </div>

            <div className="meta-item">
              <p className="meta-label">Strategy View</p>
              <p className="meta-value">This card shows the active structure only. When you roll or close contracts, the older legs move into the history section below instead of being overwritten.</p>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {structuredLegs.map((leg) => (
                <div key={leg.id} className="rounded-[24px] border border-sand-200 bg-white/85 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
                  <div className="event-headline">
                    <div>
                      <h5 className="item-title text-[1.05rem]">{leg.legRole ?? formatLegShape(leg)}</h5>
                      <p className="event-timestamp">{formatLegShape(leg)}</p>
                    </div>
                    <div className="hero-actions">
                      <div className="item-row !mt-0">
                        <span className="chip">{leg.legStatus}</span>
                        {leg.parentLegId ? <span className="chip-neutral">ROLLED REPLACEMENT</span> : null}
                      </div>
                      <button type="button" className="btn-ghost" onClick={() => setActiveModal({ kind: "leg", id: leg.id })}>Manage Leg</button>
                    </div>
                  </div>

                  <div className="event-metric-grid mt-4">
                    {renderLegMetricCard("Strike", leg.strikePrice)}
                    {renderLegMetricCard("Expiry", leg.expiryDisplay)}
                    {renderLegMetricCard("Quantity", leg.quantity)}
                    {renderLegMetricCard("Multiplier", leg.multiplier)}
                    {renderLegMetricCard("Opened", leg.openedAtDisplay)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <ul className="list-stack">
            {activeLegs.map((leg) => (
              <li key={leg.id} className="list-card space-y-4">
                <div className="event-headline">
                  <div>
                    <h4 className="item-title">{leg.legSide} {leg.legType}</h4>
                    <p className="event-timestamp">{leg.optionType ? `${leg.optionType} contract structure` : "Stock leg structure"}</p>
                  </div>
                  <div className="hero-actions">
                    <div className="item-row !mt-0">
                      <span className="chip">{leg.legStatus}</span>
                      {leg.legRole ? <span className="chip-neutral">{leg.legRole}</span> : null}
                      {leg.parentLegId ? <span className="chip-neutral">ROLLED REPLACEMENT</span> : null}
                    </div>
                    <button type="button" className="btn-ghost" onClick={() => setActiveModal({ kind: "leg", id: leg.id })}>Manage Leg</button>
                  </div>
                </div>

                <div className="event-metric-grid">
                  <div className="event-metric-card"><p className="event-metric-label">Quantity</p><p className="event-metric-value">{leg.quantity}</p></div>
                  <div className="event-metric-card"><p className="event-metric-label">Multiplier</p><p className="event-metric-value">{leg.multiplier}</p></div>
                  {leg.strikePrice ? <div className="event-metric-card"><p className="event-metric-label">Strike</p><p className="event-metric-value">{leg.strikePrice}</p></div> : null}
                  {leg.expiryDisplay ? <div className="event-metric-card"><p className="event-metric-label">Expiry</p><p className="event-metric-value">{leg.expiryDisplay}</p></div> : null}
                  <div className="event-metric-card"><p className="event-metric-label">Opened</p><p className="event-metric-value">{leg.openedAtDisplay}</p></div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {historicalLegs.length > 0 ? (
        <section className="section-stack">
          <div>
            <h3 className="section-heading">Leg History</h3>
            <p className="section-copy">Closed, expired, exercised, assigned, and rolled-out contracts remain here so the original trade path is preserved.</p>
          </div>

          <ul className="list-stack">
            {historicalLegs.map((leg) => (
              <li key={leg.id} className="list-card space-y-4">
                <div className="event-headline">
                  <div>
                    <h4 className="item-title">{leg.legRole ?? formatLegShape(leg)}</h4>
                    <p className="event-timestamp">{formatLegShape(leg)}</p>
                  </div>
                  <div className="item-row !mt-0">
                    <span className="chip">{leg.legStatus}</span>
                    {leg.parentLegId ? <span className="chip-neutral">CHILD OF PRIOR LEG</span> : null}
                  </div>
                </div>

                <div className="event-metric-grid">
                  {renderLegMetricCard("Strike", leg.strikePrice)}
                  {renderLegMetricCard("Expiry", leg.expiryDisplay)}
                  {renderLegMetricCard("Quantity", leg.quantity)}
                  {renderLegMetricCard("Multiplier", leg.multiplier)}
                  {renderLegMetricCard("Opened", leg.openedAtDisplay)}
                  {renderLegMetricCard("Closed", leg.closedAtDisplay)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="section-stack">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="section-heading">Actions</h3>
            <p className="section-copy">Build the trade timeline as it evolves.</p>
          </div>
          <div className="hero-actions">
            <button type="button" className="btn-primary" onClick={() => setActiveModal({ kind: "create-action" })}>Add Action</button>
          </div>
        </div>

        {actions.length === 0 ? (
          <div className="empty-state">No actions yet.</div>
        ) : (
          <ul className="list-stack">
            {actions.map((action) => (
              <li key={action.id} className="list-card space-y-4">
                <div className="event-headline">
                  <div>
                    <h4 className="item-title">{action.actionType} · {action.actionEffect}</h4>
                    <p className="event-timestamp">{action.actionTimestampDisplay}</p>
                  </div>
                  <div className="hero-actions">
                    <div className="item-row !mt-0">
                      {action.resultingStatus ? <span className="chip">{action.resultingStatus}</span> : null}
                      {action.locked ? <span className="chip-neutral">LOCKED</span> : null}
                    </div>
                    <button type="button" className="btn-ghost" onClick={() => { setActiveActionType(action.actionType); setActiveModal({ kind: "action", id: action.id }); }}>Manage Action</button>
                  </div>
                </div>

                <div className="event-metric-grid">
                  {!usesPremiumQuote(action.actionType) && action.amount !== null ? <div className="event-metric-card"><p className="event-metric-label">Amount</p><p className="event-metric-value">{action.amount} {action.currency}</p></div> : null}
                  {action.quantity ? <div className="event-metric-card"><p className="event-metric-label">Quantity</p><p className="event-metric-value">{action.quantity}</p></div> : null}
                  {(action.premiumPerUnit ?? (usesPremiumQuote(action.actionType) ? action.amount : null)) ? <div className="event-metric-card"><p className="event-metric-label">Premium</p><p className="event-metric-value">{action.premiumPerUnit ?? action.amount}</p></div> : null}
                  <div className="event-metric-card"><p className="event-metric-label">Fee</p><p className="event-metric-value">{action.feeAmount} {action.currency}</p></div>
                </div>

                {action.notes ? <p className="note">{action.notes}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section-stack">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="section-heading">Journal Notes</h3>
            <p className="section-copy">Keep trade thesis, plan, and review notes at the end of the workflow where they naturally belong.</p>
          </div>
          <div className="hero-actions">
            <button type="button" className="btn-secondary" onClick={() => setActiveModal({ kind: "journal" })}>Edit Journal Notes</button>
          </div>
        </div>

        <div className="list-card space-y-4">
          <div>
            <h4 className="item-title">Trade Journal Snapshot</h4>
            <p className="note mt-2">{getJournalSummary(journal)}</p>
          </div>

          <div className="meta-grid">
            <div className="meta-item"><p className="meta-label">Thesis</p><p className="meta-value">{journal.thesis || "Not added yet"}</p></div>
            <div className="meta-item"><p className="meta-label">Entry Plan</p><p className="meta-value">{journal.entryPlan || "Not added yet"}</p></div>
            <div className="meta-item"><p className="meta-label">Exit Plan</p><p className="meta-value">{journal.exitPlan || "Not added yet"}</p></div>
            <div className="meta-item md:col-span-2"><p className="meta-label">Trade Notes</p><p className="meta-value">{journal.tradeNotes || "Not added yet"}</p></div>
          </div>
        </div>
      </section>
    </>
  );
}










