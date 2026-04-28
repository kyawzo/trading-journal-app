"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ImportBatchItem = {
  id: string;
  fileName: string | null;
  batchStatus: string;
  rowCount: number | null;
  processedCount: number | null;
  errorCount: number | null;
  importedAt: string;
  completedAt: string | null;
  brokerName: string;
  accountName: string;
  failures: Array<{
    symbol: string;
    reason: string;
  }>;
  positions: Array<{
    id: string;
    underlyingSymbol: string;
    strategyType: string;
    currentStatus: string;
  }>;
  holdings: Array<{
    id: string;
    symbol: string;
    holdingStatus: string;
  }>;
};

type ImportHistoryPanelProps = {
  batches: ImportBatchItem[];
  overview: {
    batchCount: number;
    importedRows: number;
    failedRows: number;
    completedBatches: number;
    positionsCreated: number;
    holdingsTouched: number;
  };
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString();
}

export function ImportHistoryPanel({ batches, overview }: ImportHistoryPanelProps) {
  const router = useRouter();
  const [pendingBatchId, setPendingBatchId] = useState<string | null>(null);
  const [rollbackMessage, setRollbackMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const batchesById = useMemo(() => new Map(batches.map((batch) => [batch.id, batch])), [batches]);

  async function handleRollback(batchId: string) {
    const batch = batchesById.get(batchId);
    if (!batch) {
      return;
    }

    const confirmed = window.confirm(
      `Undo import for ${batch.fileName || "CSV Import"}?\n\nThis will permanently delete imported records created by this batch.`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setPendingBatchId(batchId);
      setRollbackMessage(null);

      const response = await fetch(`/api/imports/${batchId}/rollback`, {
        method: "POST",
      });

      const payload = await response.json();
      if (!response.ok) {
        setRollbackMessage({
          tone: "error",
          text: typeof payload?.error === "string" ? payload.error : "Unable to undo this import batch.",
        });
        return;
      }

      setRollbackMessage({
        tone: "success",
        text: `Import batch ${batchId.slice(0, 8)} was removed successfully.`,
      });
      router.refresh();
    } catch {
      setRollbackMessage({
        tone: "error",
        text: "Unable to undo this import batch due to a network or server issue.",
      });
    } finally {
      setPendingBatchId(null);
    }
  }

  return (
    <section className="panel-strong section-stack">
      <div>
        <h3 className="section-heading">Latest Import Runs</h3>
        <p className="section-copy">Use this to verify exactly what was written. Partial runs still insert successful rows.</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <p className="stat-label">Recent Batches</p>
          <p className="stat-value">{overview.batchCount}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Imported Rows</p>
          <p className="stat-value-positive">{overview.importedRows}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Failed Rows</p>
          <p className={overview.failedRows > 0 ? "stat-value-negative" : "stat-value"}>{overview.failedRows}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Completed Batches</p>
          <p className="stat-value">{overview.completedBatches}</p>
        </div>
      </div>

      <div className="stats-grid-2">
        <div className="stat-card">
          <p className="stat-label">Imported Positions In View</p>
          <p className="stat-value">{overview.positionsCreated}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Imported Holdings In View</p>
          <p className="stat-value">{overview.holdingsTouched}</p>
        </div>
      </div>

      {rollbackMessage ? (
        <div className={rollbackMessage.tone === "success" ? "alert-success" : "alert-error"} role="status" aria-live="polite">
          <p className="text-sm">{rollbackMessage.text}</p>
        </div>
      ) : null}

      {batches.length === 0 ? (
        <div className="empty-state">No import batches yet.</div>
      ) : (
        <ul className="list-stack">
          {batches.map((batch) => {
            const skippedRows = Math.max((batch.rowCount ?? 0) - (batch.processedCount ?? 0) - (batch.errorCount ?? 0), 0);
            const statusToneClass = batch.batchStatus === "COMPLETED"
              ? "chip"
              : batch.batchStatus === "PARTIAL"
                ? "chip-amber"
                : batch.batchStatus === "FAILED"
                  ? "chip-amber"
                  : "chip-neutral";

            const isPending = pendingBatchId === batch.id;

            return (
              <li key={batch.id} className="list-card section-stack">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h4 className="item-title">{batch.fileName || "CSV Import"}</h4>
                    <p className="note mt-2">
                      {batch.brokerName} · {batch.accountName}
                    </p>
                  </div>
                  <div className="item-row">
                    <span className={statusToneClass}>{batch.batchStatus}</span>
                    <span className="chip-neutral">Batch: {batch.id.slice(0, 8)}</span>
                  </div>
                </div>

                <div className="meta-grid">
                  <div className="meta-item">
                    <p className="meta-label">Total Rows</p>
                    <p className="meta-value">{batch.rowCount ?? 0}</p>
                  </div>
                  <div className="meta-item">
                    <p className="meta-label">Imported</p>
                    <p className="meta-value">{batch.processedCount ?? 0}</p>
                  </div>
                  <div className="meta-item">
                    <p className="meta-label">Failed</p>
                    <p className="meta-value">{batch.errorCount ?? 0}</p>
                  </div>
                  <div className="meta-item">
                    <p className="meta-label">Skipped</p>
                    <p className="meta-value">{skippedRows}</p>
                  </div>
                  <div className="meta-item">
                    <p className="meta-label">Started</p>
                    <p className="meta-value">{formatDateTime(batch.importedAt)}</p>
                  </div>
                  <div className="meta-item">
                    <p className="meta-label">Completed</p>
                    <p className="meta-value">{formatDateTime(batch.completedAt)}</p>
                  </div>
                </div>

                <div className="item-row">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleRollback(batch.id)}
                    disabled={isPending}
                  >
                    {isPending ? "Undoing..." : "Undo Import"}
                  </button>
                </div>

                <details className="rounded-[24px] border border-sand-200 bg-white/75 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-[var(--ink-2)]">
                    Review Imported Records
                  </summary>
                  <div className="mt-4 space-y-4">
                    <div className="stats-grid-2">
                      <div className="meta-item">
                        <p className="meta-label">Positions Created</p>
                        <p className="meta-value">{batch.positions.length}</p>
                      </div>
                      <div className="meta-item">
                        <p className="meta-label">Holdings Touched</p>
                        <p className="meta-value">{batch.holdings.length}</p>
                      </div>
                    </div>

                    {batch.positions.length > 0 ? (
                      <div className="space-y-3">
                        <p className="meta-label">Imported Positions</p>
                        <ul className="list-stack">
                          {batch.positions.slice(0, 5).map((position) => (
                            <li key={position.id} className="list-card">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                  <p className="item-title">{position.underlyingSymbol} · {position.strategyType}</p>
                                  <p className="note mt-2">Status: {position.currentStatus}</p>
                                </div>
                                <Link href={`/positions/${position.id}`} className="btn-ghost">Review Position</Link>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {batch.holdings.length > 0 ? (
                      <div className="space-y-3">
                        <p className="meta-label">Imported Holdings</p>
                        <ul className="list-stack">
                          {batch.holdings.slice(0, 5).map((holding) => (
                            <li key={holding.id} className="list-card">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                  <p className="item-title">{holding.symbol}</p>
                                  <p className="note mt-2">Status: {holding.holdingStatus}</p>
                                </div>
                                <Link href={`/holdings/${holding.id}`} className="btn-ghost">Review Holding</Link>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </details>

                {batch.failures.length > 0 ? (
                  <details className="rounded-[24px] border border-amber-200 bg-amber-50/60 p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-[var(--ink-2)]">
                      Failed Rows ({batch.failures.length})
                    </summary>
                    <div className="mt-4 space-y-2">
                      {batch.failures.map((failure, index) => (
                        <p key={`${batch.id}-${failure.symbol}-${failure.reason}-${index}`} className="note">
                          {failure.symbol}: {failure.reason}
                        </p>
                      ))}
                    </div>
                  </details>
                ) : (
                  <div className="meta-item">
                    <p className="meta-label">Failed Rows</p>
                    <p className="meta-value">No failed rows recorded for this batch.</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
