import { requireCurrentUser } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { formatActiveBrokerLabel, getWorkspacePreference } from "@/src/lib/workspace-preference";
import { ImportHistoryPanel } from "./import-history-panel";
import { ImportPreviewPanel } from "./import-preview-panel";

export default async function ImportsPage() {
  const user = await requireCurrentUser("/imports");
  const workspace = await getWorkspacePreference();

  const brokerAccounts = await prisma.brokerAccount.findMany({
    where: {
      userId: user.id,
      isActive: true,
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      broker: true,
    },
  });

  const brokerOptions = brokerAccounts.map((account) => ({
    id: account.id,
    label: `${account.broker.brokerName} · ${account.accountName}`,
  }));

  const defaultBrokerAccountId = workspace.activeBrokerAccountId ?? brokerOptions[0]?.id ?? "";
  const recentBatches = await prisma.importBatch.findMany({
    where: {
      brokerAccount: {
        userId: user.id,
      },
    },
    include: {
      brokerAccount: {
        include: {
          broker: true,
        },
      },
    },
    orderBy: [{ importedAt: "desc" }],
    take: 10,
  });

  const failedRows = recentBatches.length === 0
    ? []
    : await prisma.rawTransaction.findMany({
      where: {
        importBatchId: {
          in: recentBatches.map((batch) => batch.id),
        },
        processingNotes: {
          startsWith: "Failed:",
        },
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        importBatchId: true,
        symbolText: true,
        processingNotes: true,
      },
      take: 80,
    });

  const failuresByBatch = new Map<string, Array<{ symbol: string; reason: string }>>();
  for (const row of failedRows) {
    const bucket = failuresByBatch.get(row.importBatchId ?? "") ?? [];
    if (bucket.length >= 3) {
      continue;
    }

    bucket.push({
      symbol: row.symbolText ?? "N/A",
      reason: (row.processingNotes ?? "").replace(/^Failed:\s*/i, ""),
    });
    failuresByBatch.set(row.importBatchId ?? "", bucket);
  }

  const recentBatchItems = recentBatches.map((batch) => ({
    id: batch.id,
    fileName: batch.fileName,
    batchStatus: batch.batchStatus,
    rowCount: batch.rowCount,
    processedCount: batch.processedCount,
    errorCount: batch.errorCount,
    importedAt: batch.importedAt.toISOString(),
    completedAt: batch.completedAt?.toISOString() ?? null,
    brokerName: batch.brokerAccount?.broker?.brokerName ?? "Broker",
    accountName: batch.brokerAccount?.accountName ?? "Account",
    failures: failuresByBatch.get(batch.id) ?? [],
  }));

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Imports</p>
            <h2 className="page-title">Bring broker trade history into your journal safely.</h2>
            <p className="page-subtitle">
              Phase 1 now supports MooMoo CSV preview and validation with US-only + Filled-only checks, so you can verify import quality before we write holdings and positions.
            </p>
            <div className="item-row mt-4">
              <span className="chip-neutral">Active Broker: {formatActiveBrokerLabel(workspace.activeBrokerAccount)}</span>
            </div>
          </div>
        </div>
      </section>

      {brokerOptions.length === 0 ? (
        <section className="empty-state">
          No active broker account found. Create a broker account first, then return to Imports to upload your CSV.
        </section>
      ) : (
        <ImportPreviewPanel
          brokerAccounts={brokerOptions}
          defaultBrokerAccountId={defaultBrokerAccountId}
        />
      )}

      <ImportHistoryPanel batches={recentBatchItems} />
    </main>
  );
}
