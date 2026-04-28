'use client'

import { useState } from "react";
import { getPositionStrategyLegTemplate, getTemplateLegSummary } from "@/src/lib/position-leg-templates";

type PositionDetailFormsProps = {
  positionId: string;
};

type PositionLegFormProps = PositionDetailFormsProps & {
  strategyType: string;
  existingLegCount: number;
};

const ACTION_TYPES = [
  { value: "STO", label: "STO (Sell to Open)" },
  { value: "BTO", label: "BTO (Buy to Open)" },
  { value: "BTC", label: "BTC (Buy to Close)" },
  { value: "STC", label: "STC (Sell to Close)" },
  { value: "ROLL_CREDIT", label: "Roll Credit" },
  { value: "ROLL_DEBIT", label: "Roll Debit" },
  { value: "EXPIRED_WORTHLESS", label: "Expired Worthless" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "EXERCISED", label: "Exercised" },
  { value: "DIVIDEND", label: "Dividend" },
  { value: "INTEREST", label: "Interest" },
  { value: "FEE", label: "Fee" },
  { value: "NOTE", label: "Note" },
] as const;

function getActionTypeLabel(actionType: string) {
  return ACTION_TYPES.find((action) => action.value === actionType)?.label ?? actionType;
}

function getActionTypeGuidance(actionType: string) {
  switch (actionType) {
    case "STO":
      return "Opens a short option position and usually adds premium cash to the trade.";
    case "BTO":
      return "Opens a long option position and usually spends premium cash.";
    case "BTC":
      return "Closes a short option position and usually spends premium cash to buy it back.";
    case "STC":
      return "Closes a long option position and usually brings premium cash back in.";
    case "ROLL_CREDIT":
      return "Rolls an existing option structure for a net credit.";
    case "ROLL_DEBIT":
      return "Rolls an existing option structure for a net debit.";
    case "EXPIRED_WORTHLESS":
      return "Marks the option as expired worthless with no closing fill.";
    case "ASSIGNED":
      return "Marks assignment and can create a linked holding automatically.";
    case "EXERCISED":
      return "Marks exercise and records the resulting stock-side move.";
    case "DIVIDEND":
      return "Adds income cash without changing the option structure.";
    case "INTEREST":
      return "Adds broker interest income.";
    case "FEE":
      return "Records a direct broker charge or adjustment expense.";
    default:
      return "Use note-only actions when you want a timeline marker without trade cash flow.";
  }
}

const QUANTITY_ACTIONS = new Set([
  "STO",
  "BTO",
  "BTC",
  "STC",
  "ROLL_CREDIT",
  "ROLL_DEBIT",
  "ASSIGNED",
  "EXERCISED",
]);

const PREMIUM_ACTIONS = new Set([
  "STO",
  "BTO",
  "BTC",
  "STC",
  "ROLL_CREDIT",
  "ROLL_DEBIT",
]);

const AMOUNT_ACTIONS = new Set([
  "STO",
  "BTO",
  "BTC",
  "STC",
  "ROLL_CREDIT",
  "ROLL_DEBIT",
  "DIVIDEND",
  "INTEREST",
  "FEE",
  "ASSIGNED",
  "EXERCISED",
]);

const STATUS_ACTIONS = new Set([
  "STO",
  "BTO",
  "BTC",
  "STC",
  "ROLL_CREDIT",
  "ROLL_DEBIT",
  "EXPIRED_WORTHLESS",
  "ASSIGNED",
  "EXERCISED",
]);

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

export function PositionLegForm({ positionId, strategyType, existingLegCount }: PositionLegFormProps) {
  const template = getPositionStrategyLegTemplate(strategyType);
  const [manualLegType, setManualLegType] = useState("OPTION");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isManualOption = manualLegType === "OPTION";

  async function handleTemplateFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch(`/api/positions/${positionId}/legs`, {
        method: "POST",
        body: formData,
      });

      const contentType = response.headers.get("content-type");
      
      if (response.ok) {
        // Redirect to refresh the position page
        window.location.href = `/positions/${positionId}`;
        return;
      }

      if (contentType?.includes("application/json")) {
        const data = await response.json();
        setError(data.error || "An error occurred. Please try again.");
      } else {
        const text = await response.text();
        // Extract error message from redirect URL parameters if available
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

  if (template && existingLegCount > 0) {
    return (
      <div className="form-card space-y-4">
        <div>
          <h3 className="section-heading">{template.label} Structure Already Created</h3>
          <p className="section-copy">
            This position already has its generated strategy legs. Use <strong>Manage Leg</strong> on the existing rows to adjust strikes,
            expiry, quantity, or leg status instead of creating duplicate structure.
          </p>
        </div>

        <div className="meta-item">
          <p className="meta-label">Current Strategy Shape</p>
          <p className="meta-value">{getTemplateLegSummary(template)}</p>
        </div>
      </div>
    );
  }

  if (template) {
    const isOptionTemplate = template.mode !== "single-stock";

    return (
      <form
        onSubmit={handleTemplateFormSubmit}
        className="flex min-h-0 flex-1 flex-col"
      >
        {error ? (
          <div className="alert-error">
            <p className="font-semibold">Validation Error</p>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        ) : null}

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
          <div className="meta-item">
            <p className="meta-label">Generated Legs</p>
            <p className="meta-value">{getTemplateLegSummary(template)}</p>
          </div>

        <div className="form-grid">
          {template.mode === "single-option" ? (
            <Field label="Strike Price">
              <input name="singleStrike" type="number" step="0.01" className="input-field" required />
            </Field>
          ) : null}

          {template.mode === "vertical-spread" ? (
            <>
              {strategyType === "BULL_CALL_SPREAD" ? (
                <>
                  <Field label="Long Call Strike">
                    <input name="longStrike" type="number" step="0.01" className="input-field" required />
                  </Field>
                  <Field label="Short Call Strike">
                    <input name="shortStrike" type="number" step="0.01" className="input-field" required />
                  </Field>
                </>
              ) : strategyType === "BEAR_PUT_SPREAD" ? (
                <>
                  <Field label="Long Put Strike">
                    <input name="longStrike" type="number" step="0.01" className="input-field" required />
                  </Field>
                  <Field label="Short Put Strike">
                    <input name="shortStrike" type="number" step="0.01" className="input-field" required />
                  </Field>
                </>
              ) : strategyType === "BULL_PUT_SPREAD" ? (
                <>
                  <Field label="Short Put Strike">
                    <input name="shortStrike" type="number" step="0.01" className="input-field" required />
                  </Field>
                  <Field label="Long Put Strike">
                    <input name="longStrike" type="number" step="0.01" className="input-field" required />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Short Call Strike">
                    <input name="shortStrike" type="number" step="0.01" className="input-field" required />
                  </Field>
                  <Field label="Long Call Strike">
                    <input name="longStrike" type="number" step="0.01" className="input-field" required />
                  </Field>
                </>
              )}
            </>
          ) : null}

          {template.mode === "iron-condor" ? (
            <>
              <Field label="Long Put Strike">
                <input name="longPutStrike" type="number" step="0.01" className="input-field" required />
              </Field>
              <Field label="Short Put Strike">
                <input name="shortPutStrike" type="number" step="0.01" className="input-field" required />
              </Field>
              <Field label="Short Call Strike">
                <input name="shortCallStrike" type="number" step="0.01" className="input-field" required />
              </Field>
              <Field label="Long Call Strike">
                <input name="longCallStrike" type="number" step="0.01" className="input-field" required />
              </Field>
            </>
          ) : null}

          {isOptionTemplate ? (
            <Field label="Expiry Date">
              <input name="expiryDate" type="date" className="input-field" required />
            </Field>
          ) : null}

          <Field label={isOptionTemplate ? "Contract Quantity" : "Share Quantity"}>
            <input
              name="quantity"
              type="number"
              step="0.01"
              className="input-field"
              defaultValue="1"
              required
            />
          </Field>

          <Field label="Multiplier">
            <input
              name="multiplier"
              type="number"
              step="1"
              className="input-field"
              defaultValue={isOptionTemplate ? "100" : "1"}
              required
            />
          </Field>
        </div>

        </div>

        <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
          <button type="button" className="btn-ghost" onClick={() => {}} disabled>Cancel</button>
          <button type="submit" className="btn-accent" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Legs"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      method="POST"
      action={`/api/positions/${positionId}/legs`}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">
        <div>
          <h3 className="section-heading">Add Leg</h3>
          <p className="section-copy">
            Build the structure incrementally. Use stock legs for shares and option legs for contract details.
          </p>
        </div>

      <div className="form-grid">
        <Field label="Leg Type">
          <select
            name="legType"
            className="select-field"
            defaultValue="OPTION"
            onChange={(event) => setManualLegType(event.target.value)}
          >
            <option value="OPTION">OPTION</option>
            <option value="STOCK">STOCK</option>
          </select>
        </Field>

        <Field label="Leg Side">
          <select
            name="legSide"
            className="select-field"
            defaultValue="SHORT"
          >
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </Field>

        {isManualOption ? (
          <>
            <Field label="Option Type">
              <select
                name="optionType"
                className="select-field"
                defaultValue="PUT"
                required
              >
                <option value="CALL">CALL</option>
                <option value="PUT">PUT</option>
              </select>
            </Field>

            <Field label="Strike Price">
              <input
                name="strikePrice"
                type="number"
                step="0.01"
                className="input-field"
                required
              />
            </Field>

            <Field label="Expiry Date">
              <input
                name="expiryDate"
                type="date"
                className="input-field"
                required
              />
            </Field>

            <div className="meta-item md:col-span-2">
              <p className="meta-label">Option Requirements</p>
              <p className="meta-value">Option legs require option type, strike price, and expiry date.</p>
            </div>
          </>
        ) : (
          <div className="meta-item md:col-span-2">
            <p className="meta-label">Stock Leg</p>
            <p className="meta-value">Stock legs only require side, quantity, and optional role.</p>
          </div>
        )}

        <Field label="Quantity">
          <input
            name="quantity"
            type="number"
            step="0.01"
            className="input-field"
            defaultValue="1"
            required
          />
        </Field>

        <Field label="Multiplier">
          <input
            name="multiplier"
            type="number"
            step="1"
            className="input-field"
            defaultValue={isManualOption ? "100" : "1"}
          />
        </Field>

        <Field label="Leg Role">
          <input
            name="legRole"
            className="input-field"
            placeholder={isManualOption ? "SHORT_PUT" : "Optional"}
          />
        </Field>
      </div>
      </div>

      <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
        <button type="button" className="btn-ghost" onClick={() => {}} disabled>Cancel</button>
        <button className="btn-accent">Add Leg</button>
      </div>
    </form>
  );
}

export function PositionActionForm({ positionId }: PositionDetailFormsProps) {
  const [actionType, setActionType] = useState("STO");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const showAmount = AMOUNT_ACTIONS.has(actionType) && !PREMIUM_ACTIONS.has(actionType);
  const showQuantity = QUANTITY_ACTIONS.has(actionType);
  const showPremium = PREMIUM_ACTIONS.has(actionType);
  const showAssignment = actionType === "ASSIGNED";
  const showStatus = STATUS_ACTIONS.has(actionType);

  async function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch(`/api/positions/${positionId}/actions`, {
        method: "POST",
        headers: {
          "x-ui-submit-mode": "fetch",
        },
        body: formData,
      });

      if (response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          const data = await response.json();
          window.location.href = data.redirectTo || `/positions/${positionId}?tone=success&notice=Action+added+successfully.`;
        } else {
          window.location.href = `/positions/${positionId}?tone=success&notice=Action+added+successfully.`;
        }
        return;
      }

      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        const data = await response.json();
        setError(data.error || data.notice || "An error occurred. Please try again.");
      } else {
        setError("An error occurred. Please try again.");
      }
    } catch (err) {
      setError("Failed to submit form. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleFormSubmit}
      className="flex min-h-0 flex-1 flex-col"
    >
      {error ? (
        <div className="alert-error">
          <span>{error}</span>
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.35rem" }} className="space-y-4">


      <div className="form-grid">
        <Field label="Action Type">
          <select
            name="actionType"
            className="select-field"
            value={actionType}
            onChange={(event) => setActionType(event.target.value)}
          >
            {ACTION_TYPES.map((action) => (
              <option key={action.value} value={action.value}>
                {action.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="meta-item md:col-span-2">
          <p className="meta-label">Selected Action</p>
          <p className="meta-value">{getActionTypeLabel(actionType)}</p>
          <p className="note mt-2">{getActionTypeGuidance(actionType)}</p>
        </div>

        <Field label="Action Timestamp">
          <input
            name="actionTimestamp"
            type="datetime-local"
            className="input-field"
            defaultValue={formatDateTimeLocalInput(new Date())}
            required
          />
        </Field>

        <Field label="Discipline Rating">
          <select name="disciplineRating" className="select-field" defaultValue="UNRATED">
            <option value="UNRATED">UNRATED</option>
            <option value="FOLLOWED_PLAN">FOLLOWED_PLAN</option>
            <option value="ADJUSTED">ADJUSTED</option>
            <option value="BROKE_RULES">BROKE_RULES</option>
          </select>
        </Field>

        <Field label="Currency">
          <select name="currency" className="select-field" defaultValue="USD">
            <option value="USD">USD</option>
            <option value="SGD">SGD</option>
          </select>
        </Field>

        {showQuantity ? (
          <Field label="Quantity">
            <input
              name="quantity"
              type="number"
              step="0.01"
              className="input-field"
            />
          </Field>
        ) : null}

        {showPremium ? (
          <Field label="Premium">
            <input
              name="premium"
              type="number"
              step="0.01"
              className="input-field"
            />
          </Field>
        ) : null}

        <Field label="Fee Amount">
          <input
            name="feeAmount"
            type="number"
            step="0.01"
            defaultValue="0"
            className="input-field"
          />
        </Field>

        {showAmount ? (
          <Field label="Amount">
            <input
              name="amount"
              type="number"
              step="0.01"
              className="input-field"
            />
          </Field>
        ) : null}

        {showAssignment ? (
          <>
            <Field label="Assignment Share Quantity">
              <input
                name="assignmentShareQty"
                type="number"
                step="1"
                className="input-field"
                defaultValue="100"
              />
            </Field>

            <Field label="Assignment Price Per Share">
              <input
                name="assignmentPrice"
                type="number"
                step="0.01"
                className="input-field"
              />
            </Field>
          </>
        ) : null}

        {showStatus ? (
          <Field label="Resulting Status">
            <select name="resultingStatus" className="select-field">
              <option value="">-- Auto Detect --</option>
              <option value="OPEN">OPEN</option>
              <option value="PARTIALLY_CLOSED">PARTIALLY_CLOSED</option>
              <option value="CLOSED">CLOSED</option>
              <option value="ROLLED">ROLLED</option>
              <option value="ASSIGNED">ASSIGNED</option>
              <option value="EXPIRED">EXPIRED</option>
              <option value="EXERCISED">EXERCISED</option>
            </select>
          </Field>
        ) : null}
      </div>

      <div className="meta-item">
        <p className="meta-label">Action Guidance</p>
        <p className="meta-value">
          {showAssignment
            ? "Assignment updates the position status and can create a linked holding automatically."
            : showPremium
              ? "For option actions, enter the premium quote only. Double-check STO vs BTC or BTO vs STC before saving. The app calculates cash as premium x contracts x 100."
              : showAmount
                ? "Use amount for cash-moving actions such as dividends, interest, fees, exercise, or assignment."
                : "Use notes-only actions when you want a journal marker without a trade amount or quantity."}
        </p>
      </div>

      <Field label="Notes">
        <textarea
          name="notes"
          className="textarea-field min-h-28"
          rows={3}
        />
      </Field>
      </div>

      <div className="modal-actions pt-6" style={{ borderTop: "1px solid var(--line)" }}>
        <button type="button" className="btn-ghost" onClick={() => {}} disabled>Cancel</button>
        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? "Adding..." : "Add Action"}
        </button>
      </div>
    </form>
  );
}




