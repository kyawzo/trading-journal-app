"use client";

import { useEffect, useState } from "react";

type BrokerAccountOption = {
  id: string;
  label: string;
};

type ImportPreviewPanelProps = {
  brokerAccounts: BrokerAccountOption[];
  defaultBrokerAccountId: string;
};

type PreviewResponse = {
  fileName: string;
  summary: {
    totalRows: number;
    processableRows: number;
    holdingsRows: number;
    positionRows: number;
    optionRows: number;
    spreadRows: number;
    holdingSymbolsCount: number;
    skippedStatusRows: number;
    skippedNonUsRows: number;
    skippedInvalidRows: number;
    detectedCurrencies: string[];
  };
  rows: Array<{
    rowNumber: number;
    symbol: string;
    side: string;
    market: string;
    status: string;
    assetType: "HOLDING" | "POSITION";
    quantity: number | null;
    price: number | null;
    amount: number | null;
    feeAmount: number;
    skipReason: string | null;
  }>;
  warnings: string[];
};

type PreviewErrorResponse = {
  error?: string;
  code?: string;
  detectedCurrencies?: string[];
  brokerAccountCurrency?: string;
  suggestedBrokerAccounts?: Array<{ id: string; label: string }>;
};

type CommitResponse = {
  importBatchId: string;
  summary: {
    totalRows: number;
    processableRows: number;
    skippedRows: number;
    importedRows: number;
    failedRows: number;
    holdingsCreated: number;
    holdingEventsCreated: number;
    positionsCreated: number;
    positionActionsCreated: number;
    rawTransactionsCreated: number;
    cashLedgerEntriesCreated: number;
  };
  failures: Array<{
    rowNumber: number;
    symbol: string;
    reason: string;
  }>;
};

function formatMaybeNumber(value: number | null) {
  return value === null ? "—" : value.toLocaleString();
}

export function ImportPreviewPanel({
  brokerAccounts,
  defaultBrokerAccountId,
}: ImportPreviewPanelProps) {
  const [selectedBrokerAccountId, setSelectedBrokerAccountId] = useState(defaultBrokerAccountId);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResponse | null>(null);
  const [importAlert, setImportAlert] = useState<{
    tone: "success" | "error";
    title: string;
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const selectedBrokerLabel = brokerAccounts.find((account) => account.id === selectedBrokerAccountId)?.label ?? "Unknown account";
  const selectedBrokerCurrency = selectedBrokerLabel.split(" · ").at(-1) ?? "N/A";

  useEffect(() => {
    if (!importAlert) {
      return;
    }

    const timeout = window.setTimeout(() => setImportAlert(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [importAlert]);

  async function handlePreviewSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setImportAlert({
        tone: "error",
        title: "Preview failed",
        message: "Please choose a CSV file first.",
      });
      setResult(null);
      return;
    }

    const formData = new FormData();
    formData.set("brokerAccountId", selectedBrokerAccountId);
    formData.set("file", file);

    try {
      setIsSubmitting(true);
      setCommitResult(null);
      setImportAlert(null);

      const response = await fetch("/api/imports/preview", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as PreviewErrorResponse | PreviewResponse;
      if (!response.ok) {
        setResult(null);
        const message = typeof (payload as PreviewErrorResponse)?.error === "string"
          ? (payload as PreviewErrorResponse).error!
          : "Unable to preview this CSV file.";
        const suggestion = ((payload as PreviewErrorResponse).suggestedBrokerAccounts ?? []).map((item) => item.label).join("; ");
        const enrichedMessage = suggestion ? `${message} Try account: ${suggestion}` : message;
        setImportAlert({
          tone: "error",
          title: "Preview failed",
          message: enrichedMessage,
        });
        return;
      }

      setResult(payload as PreviewResponse);
    } catch {
      setResult(null);
      const message = "Import preview failed due to a network or server issue.";
      setImportAlert({
        tone: "error",
        title: "Preview failed",
        message,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCommitImport() {
    if (!file) {
      setImportAlert({
        tone: "error",
        title: "Import failed",
        message: "Please choose a CSV file first.",
      });
      return;
    }

    const formData = new FormData();
    formData.set("brokerAccountId", selectedBrokerAccountId);
    formData.set("file", file);

    try {
      setIsCommitting(true);
      setCommitResult(null);
      setImportAlert(null);

      const response = await fetch("/api/imports/commit", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        const message = typeof payload?.error === "string" ? payload.error : "Import failed.";
        setImportAlert({
          tone: "error",
          title: "Import failed",
          message,
        });
        return;
      }

      const commitPayload = payload as CommitResponse;
      setCommitResult(commitPayload);

      if (commitPayload.summary.failedRows === 0) {
        setImportAlert({
          tone: "success",
          title: "Import completed",
          message: `Imported ${commitPayload.summary.importedRows} row(s) successfully.`,
        });
      } else if (commitPayload.summary.importedRows > 0) {
        setImportAlert({
          tone: "error",
          title: "Import partially completed",
          message: `Imported ${commitPayload.summary.importedRows} row(s), failed ${commitPayload.summary.failedRows} row(s).`,
        });
      } else {
        setImportAlert({
          tone: "error",
          title: "Import failed",
          message: `No rows were imported. Failed rows: ${commitPayload.summary.failedRows}.`,
        });
      }
    } catch {
      const message = "Import failed due to a network or server issue.";
      setImportAlert({
        tone: "error",
        title: "Import failed",
        message,
      });
    } finally {
      setIsCommitting(false);
    }
  }

  return (
    <section className="panel-strong section-stack">
      {importAlert ? (
        <section className={importAlert.tone === "success" ? "alert-success" : "alert-error"} role="status" aria-live="polite">
          <p className="font-semibold">{importAlert.title}</p>
          <p className="mt-1 text-sm">{importAlert.message}</p>
        </section>
      ) : null}

      <div>
        <h3 className="section-heading">Upload CSV Preview</h3>
        <p className="section-copy">This preview validates MooMoo CSV structure and tells us what would be imported before any trade writes happen.</p>
      </div>

      <form className="section-stack" onSubmit={handlePreviewSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="field-stack">
            <span className="field-label">Broker Account</span>
            <select
              className="select-field"
              value={selectedBrokerAccountId}
              onChange={(event) => setSelectedBrokerAccountId(event.target.value)}
            >
              {brokerAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field-stack">
            <span className="field-label">MooMoo CSV File</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="input-field"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <div className="hero-actions">
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Previewing..." : "Preview Import"}
          </button>
          {result && result.summary.processableRows > 0 ? (
            <button type="button" className="btn-secondary" onClick={handleCommitImport} disabled={isCommitting}>
              {isCommitting ? "Importing..." : "Run Import"}
            </button>
          ) : null}
        </div>
        <p className="note" style={{ color: "var(--danger, #b91c1c)", fontWeight: 600 }}>
          Selected account currency: <code>{selectedBrokerCurrency}</code>. Import is allowed only when CSV currency matches this account.
        </p>
      </form>

      {commitResult ? (
        <div className="empty-state">
          <p>Import completed. Batch: <code>{commitResult.importBatchId}</code></p>
          <p>Imported rows: {commitResult.summary.importedRows} / {commitResult.summary.processableRows}</p>
          <p>Holdings created: {commitResult.summary.holdingsCreated}, holding events: {commitResult.summary.holdingEventsCreated}</p>
          <p>Positions created: {commitResult.summary.positionsCreated}, actions: {commitResult.summary.positionActionsCreated}</p>
          <p>Cash entries created: {commitResult.summary.cashLedgerEntriesCreated}</p>
          {commitResult.summary.failedRows > 0 ? (
            <p>Failed rows: {commitResult.summary.failedRows} (see first rows below).</p>
          ) : null}
          {commitResult.failures.slice(0, 5).map((failure) => (
            <p key={`${failure.rowNumber}-${failure.symbol}`}>
              Row {failure.rowNumber} ({failure.symbol}): {failure.reason}
            </p>
          ))}
        </div>
      ) : null}

      {result ? (
        <div className="section-stack">
          <div className="stats-grid-3">
            <div className="stat-card">
              <p className="stat-label">Rows Read</p>
              <p className="stat-value">{result.summary.totalRows}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Rows Importable</p>
              <p className="stat-value-positive">{result.summary.processableRows}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Rows Skipped</p>
              <p className="stat-value-negative">
                {result.summary.skippedStatusRows + result.summary.skippedNonUsRows + result.summary.skippedInvalidRows}
              </p>
            </div>
          </div>

          <div className="meta-grid">
            <div className="meta-item">
              <p className="meta-label">Holdings Rows</p>
              <p className="meta-value">{result.summary.holdingsRows} ({result.summary.holdingSymbolsCount} symbols)</p>
            </div>
            <div className="meta-item">
              <p className="meta-label">Position Rows</p>
              <p className="meta-value">{result.summary.positionRows} (options: {result.summary.optionRows}, spreads: {result.summary.spreadRows})</p>
            </div>
            <div className="meta-item">
              <p className="meta-label">Skipped Status</p>
              <p className="meta-value">{result.summary.skippedStatusRows}</p>
            </div>
            <div className="meta-item">
              <p className="meta-label">Skipped Non-US</p>
              <p className="meta-value">{result.summary.skippedNonUsRows}</p>
            </div>
            <div className="meta-item">
              <p className="meta-label">Detected Currency</p>
              <p className="meta-value">{result.summary.detectedCurrencies.join(", ") || "N/A"}</p>
            </div>
          </div>

          {result.warnings.length > 0 ? (
            <div className="empty-state">
              {result.warnings.slice(0, 8).map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}

          <div className="section-stack">
            <h4 className="section-heading">Sample Rows</h4>
            <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--line)" }}>
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr style={{ background: "var(--card-surface-soft)" }}>
                    <th className="px-3 py-2 text-left">Row</th>
                    <th className="px-3 py-2 text-left">Symbol</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Side</th>
                    <th className="px-3 py-2 text-left">Qty</th>
                    <th className="px-3 py-2 text-left">Price</th>
                    <th className="px-3 py-2 text-left">Amount</th>
                    <th className="px-3 py-2 text-left">Skip Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 20).map((row) => (
                    <tr key={row.rowNumber} className="border-t" style={{ borderColor: "var(--line)" }}>
                      <td className="px-3 py-2">{row.rowNumber}</td>
                      <td className="px-3 py-2">{row.symbol}</td>
                      <td className="px-3 py-2">{row.assetType}</td>
                      <td className="px-3 py-2">{row.side}</td>
                      <td className="px-3 py-2">{formatMaybeNumber(row.quantity)}</td>
                      <td className="px-3 py-2">{formatMaybeNumber(row.price)}</td>
                      <td className="px-3 py-2">{formatMaybeNumber(row.amount)}</td>
                      <td className="px-3 py-2">{row.skipReason ?? "Importable"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
