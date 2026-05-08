import Link from "next/link";
import { ImportBatchStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import {
  formatActiveBrokerLabel,
  getWorkspacePreference,
} from "@/src/lib/workspace-preference";

type FailureReasonCount = {
  reason: string;
  count: number;
};

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatDateTime(value: Date | null) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString();
}

function parseFailureReason(processingNotes: string | null | undefined) {
  if (!processingNotes || !processingNotes.startsWith("Failed:")) {
    return null;
  }

  return processingNotes.replace(/^Failed:\s*/, "").trim() || null;
}

export default async function ImportQualityReportPage() {
  const workspace = await getWorkspacePreference();

  if (!workspace.activeBrokerAccountId) {
    return (
      <main className="page-shell section-stack">
        <section className="hero-card section-stack">
          <div>
            <p className="eyebrow">Import Quality Report</p>
            <h2 className="page-title">Audit import reliability and data trust</h2>
            <p className="page-subtitle">Select an active broker account first to view broker-scoped reports.</p>
          </div>
          <div className="item-row">
            <Link href="/broker-accounts" className="btn-primary">Select Active Broker</Link>
            <Link href="/reports" className="btn-ghost">Back to Reports</Link>
          </div>
        </section>
      </main>
    );
  }

  const batches = await prisma.importBatch.findMany({
    where: {
      brokerAccountId: workspace.activeBrokerAccountId,
    },
    include: {
      rawTransactions: {
        select: {
          symbolText: true,
          processingNotes: true,
        },
      },
    },
    orderBy: [{ importedAt: "desc" }],
  });

  const batchCount = batches.length;
  const completedBatches = batches.filter((batch) => batch.batchStatus === ImportBatchStatus.COMPLETED).length;
  const partialBatches = batches.filter((batch) => batch.batchStatus === ImportBatchStatus.PARTIAL).length;
  const failedBatches = batches.filter((batch) => batch.batchStatus === ImportBatchStatus.FAILED).length;
  const processingBatches = batches.filter((batch) => batch.batchStatus === ImportBatchStatus.PROCESSING || batch.batchStatus === ImportBatchStatus.PENDING).length;

  const totalRows = batches.reduce((sum, batch) => sum + (batch.rowCount ?? 0), 0);
  const importedRows = batches.reduce((sum, batch) => sum + (batch.processedCount ?? 0), 0);
  const failedRows = batches.reduce((sum, batch) => sum + (batch.errorCount ?? 0), 0);
  const skippedRows = batches.reduce((sum, batch) => sum + Math.max((batch.rowCount ?? 0) - (batch.processedCount ?? 0) - (batch.errorCount ?? 0), 0), 0);
  const successRate = totalRows > 0 ? (importedRows / totalRows) * 100 : 0;
  const failureRate = totalRows > 0 ? (failedRows / totalRows) * 100 : 0;

  const failureReasonMap = new Map<string, number>();
  const symbolFailureMap = new Map<string, number>();

  for (const batch of batches) {
    for (const txn of batch.rawTransactions) {
      const reason = parseFailureReason(txn.processingNotes);
      if (reason) {
        failureReasonMap.set(reason, (failureReasonMap.get(reason) ?? 0) + 1);
        if (txn.symbolText) {
          symbolFailureMap.set(txn.symbolText, (symbolFailureMap.get(txn.symbolText) ?? 0) + 1);
        }
      }
    }
  }

  const topFailureReasons: FailureReasonCount[] = Array.from(failureReasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const topFailureSymbols = Array.from(symbolFailureMap.entries())
    .map(([symbol, count]) => ({ symbol, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return (
    <main className="page-shell section-stack">
      <section className="hero-card section-stack">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Import Quality Report</p>
            <h2 className="page-title">Audit import reliability and data trust</h2>
            <p className="page-subtitle">
              Review batch outcomes, row-level success rates, recurring failure reasons, and current undo availability for the active broker account.
            </p>
            <div className="item-row mt-4">
              <span className="chip-neutral">Active Broker: {formatActiveBrokerLabel(workspace.activeBrokerAccount)}</span>
            </div>
          </div>
          <div className="hero-actions">
            <Link href="/reports" className="btn-ghost">Back to Reports</Link>
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Import Batches</p>
            <p className="stat-value">{batchCount}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Imported Rows</p>
            <p className="stat-value-positive">{importedRows}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Failed Rows</p>
            <p className={failedRows > 0 ? "stat-value-negative" : "stat-value"}>{failedRows}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Skipped Rows</p>
            <p className="stat-value">{skippedRows}</p>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Success Rate</p>
            <p className="stat-value-positive">{formatPercent(successRate)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Failure Rate</p>
            <p className={failureRate > 0 ? "stat-value-negative" : "stat-value"}>{formatPercent(failureRate)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Completed Batches</p>
            <p className="stat-value">{completedBatches}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Undo Available</p>
            <p className="stat-value">{completedBatches + partialBatches + failedBatches}</p>
            <p className="note mt-2">Current batches can still be undone from Import History</p>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Completed</p>
            <p className="stat-value">{completedBatches}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Partial</p>
            <p className="stat-value">{partialBatches}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Failed</p>
            <p className="stat-value">{failedBatches}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Pending / Processing</p>
            <p className="stat-value">{processingBatches}</p>
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Top Failure Reasons</h3>
          <p className="section-copy">The recurring row-level issues currently causing import failures for this broker account.</p>
        </div>

        {topFailureReasons.length === 0 ? (
          <div className="empty-state">No failed-row reasons recorded for current import batches.</div>
        ) : (
          <ul className="list-stack">
            {topFailureReasons.map((row) => (
              <li key={row.reason} className="list-card">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="item-title">{row.reason}</h4>
                    <p className="note mt-2">Failed row count</p>
                  </div>
                  <p className="stat-value-negative">{row.count}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Most Affected Symbols</h3>
          <p className="section-copy">Symbols that appeared most often in failed import rows.</p>
        </div>

        {topFailureSymbols.length === 0 ? (
          <div className="empty-state">No symbol-level import failures recorded.</div>
        ) : (
          <ul className="list-stack">
            {topFailureSymbols.map((row) => (
              <li key={row.symbol} className="list-card">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="item-title">{row.symbol}</h4>
                    <p className="note mt-2">Failed row occurrences</p>
                  </div>
                  <p className="stat-value-negative">{row.count}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Recent Import Batches</h3>
          <p className="section-copy">A compact audit trail of the latest batches still present in the system.</p>
        </div>

        {batches.length === 0 ? (
          <div className="empty-state">No import batches yet for the selected broker account.</div>
        ) : (
          <ul className="list-stack">
            {batches.slice(0, 10).map((batch) => {
              const skipped = Math.max((batch.rowCount ?? 0) - (batch.processedCount ?? 0) - (batch.errorCount ?? 0), 0);
              return (
                <li key={batch.id} className="list-card">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h4 className="item-title">{batch.fileName || "CSV Import"}</h4>
                      <p className="note mt-2">
                        {batch.batchStatus} · imported {batch.processedCount ?? 0} / {batch.rowCount ?? 0} rows
                      </p>
                      <div className="item-row mt-3">
                        <span className="chip-neutral">Batch: {batch.id.slice(0, 8)}</span>
                        <span className="chip-neutral">Started: {formatDateTime(batch.importedAt)}</span>
                        <span className="chip-neutral">Completed: {formatDateTime(batch.completedAt)}</span>
                      </div>
                    </div>
                    <div className="grid min-w-[280px] gap-3 md:grid-cols-2">
                      <div className="event-metric-card">
                        <p className="event-metric-label">Imported</p>
                        <p className="event-metric-value">{batch.processedCount ?? 0}</p>
                      </div>
                      <div className="event-metric-card">
                        <p className="event-metric-label">Failed</p>
                        <p className="event-metric-value">{batch.errorCount ?? 0}</p>
                      </div>
                      <div className="event-metric-card">
                        <p className="event-metric-label">Skipped</p>
                        <p className="event-metric-value">{skipped}</p>
                      </div>
                      <div className="event-metric-card">
                        <p className="event-metric-label">Parser Version</p>
                        <p className="event-metric-value">{batch.parserVersion ?? "—"}</p>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="section-stack">
        <div className="alert-amber" role="status">
          <p className="text-sm">
            Rollback history is not persisted as a separate audit log yet. This report reflects current import batches still present in the database and the row-level failure notes recorded during those imports.
          </p>
        </div>
      </section>
    </main>
  );
}
