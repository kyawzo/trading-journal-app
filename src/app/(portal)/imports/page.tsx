import { ImportBatchStatus, Prisma } from "@prisma/client";
import Link from "next/link";
import { PaginationControls } from "@/src/app/components/pagination-controls";
import { requireCurrentUser } from "@/src/lib/auth";
import { paginationMeta, parsePositiveInt } from "@/src/lib/listing-pagination";
import { prisma } from "@/src/lib/prisma";
import { formatActiveBrokerLabel, getWorkspacePreference } from "@/src/lib/workspace-preference";
import { ImportHistoryPanel } from "./import-history-panel";
import { ImportPreviewPanel } from "./import-preview-panel";

const PAGE_SIZE = 20;

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultDateWindow() {
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return {
    from: formatDateInput(defaultFrom),
    to: formatDateInput(today),
  };
}

type PageProps = {
  searchParams: Promise<{
    page?: string;
    status?: string;
    brokerAccountId?: string;
    q?: string;
    from?: string;
    to?: string;
    failedOnly?: string;
  }>;
};

export default async function ImportsPage({ searchParams }: PageProps) {
  const { page, status, brokerAccountId, q, from, to, failedOnly } = await searchParams;
  const user = await requireCurrentUser("/imports");
  const workspace = await getWorkspacePreference();
  const currentPage = parsePositiveInt(page, 1);
  const statusFilter = status ?? "all";
  const selectedBrokerAccountId = (brokerAccountId ?? "").trim();
  const fileQuery = (q ?? "").trim();
  const failedOnlyFilter = failedOnly === "1";
  const validStatuses = new Set(Object.values(ImportBatchStatus));
  const validStatusFilter = validStatuses.has(statusFilter as ImportBatchStatus) || statusFilter === "all"
    ? statusFilter
    : "all";

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
    label: `${account.broker.brokerName} · ${account.accountName} · ${account.baseCurrency}`,
  }));

  const defaultBrokerAccountId = workspace.activeBrokerAccountId ?? brokerOptions[0]?.id ?? "";
  const defaultWindow = getDefaultDateWindow();
  const fromValue = from === undefined ? defaultWindow.from : from;
  const toValue = to === undefined ? defaultWindow.to : to;
  const fromDate = fromValue ? new Date(`${fromValue}T00:00:00`) : null;
  const toDate = toValue ? new Date(`${toValue}T23:59:59`) : null;
  const batchWhere: Prisma.ImportBatchWhereInput = {
    brokerAccount: {
      userId: user.id,
    },
    ...(validStatusFilter !== "all" ? { batchStatus: validStatusFilter as ImportBatchStatus } : {}),
    ...(selectedBrokerAccountId ? { brokerAccountId: selectedBrokerAccountId } : {}),
    ...(fileQuery ? { fileName: { contains: fileQuery, mode: "insensitive" } } : {}),
    ...(failedOnlyFilter ? { errorCount: { gt: 0 } } : {}),
    ...((fromDate || toDate)
      ? {
        importedAt: {
          ...(fromDate ? { gte: fromDate } : {}),
          ...(toDate ? { lte: toDate } : {}),
        },
      }
      : {}),
  };

  const totalCount = await prisma.importBatch.count({ where: batchWhere });
  const meta = paginationMeta(totalCount, currentPage, PAGE_SIZE);

  const recentBatches = await prisma.importBatch.findMany({
    where: batchWhere,
    include: {
      brokerAccount: {
        include: {
          broker: true,
        },
      },
    },
    orderBy: [{ importedAt: "desc" }],
    skip: meta.skip,
    take: meta.pageSize,
  });
  const recentBatchIds = recentBatches.map((batch) => batch.id);
  const importPrefixes = new Map(recentBatchIds.map((batchId) => [batchId, `IMPORT:${batchId}:`]));

  const [failedRows, importedPositionActions, importedHoldingEvents] = recentBatches.length === 0
    ? [[], [], []] as const
    : await Promise.all([
      prisma.rawTransaction.findMany({
      where: {
        importBatchId: {
          in: recentBatchIds,
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
      take: 300,
    }),
      prisma.positionAction.findMany({
        where: {
          OR: recentBatchIds.map((batchId) => ({
            brokerReference: {
              startsWith: `IMPORT:${batchId}:`,
            },
          })),
        },
        select: {
          brokerReference: true,
          position: {
            select: {
              id: true,
              underlyingSymbol: true,
              strategyType: true,
              currentStatus: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }],
      }),
      prisma.holdingEvent.findMany({
        where: {
          OR: recentBatchIds.map((batchId) => ({
            notes: {
              contains: `IMPORT:${batchId}:`,
              mode: "insensitive",
            },
          })),
        },
        select: {
          notes: true,
          holding: {
            select: {
              id: true,
              symbol: true,
              holdingStatus: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }],
      }),
    ]);

  const failuresByBatch = new Map<string, Array<{ symbol: string; reason: string }>>();
  for (const row of failedRows) {
    const bucket = failuresByBatch.get(row.importBatchId ?? "") ?? [];
    bucket.push({
      symbol: row.symbolText ?? "N/A",
      reason: (row.processingNotes ?? "").replace(/^Failed:\s*/i, ""),
    });
    failuresByBatch.set(row.importBatchId ?? "", bucket);
  }

  const positionsByBatch = new Map<string, Array<{ id: string; underlyingSymbol: string; strategyType: string; currentStatus: string }>>();
  for (const action of importedPositionActions) {
    const matchedBatchId = recentBatchIds.find((batchId) => action.brokerReference?.startsWith(importPrefixes.get(batchId) ?? ""));
    if (!matchedBatchId) {
      continue;
    }

    const bucket = positionsByBatch.get(matchedBatchId) ?? [];
    if (!bucket.some((position) => position.id === action.position.id)) {
      bucket.push(action.position);
      positionsByBatch.set(matchedBatchId, bucket);
    }
  }

  const holdingsByBatch = new Map<string, Array<{ id: string; symbol: string; holdingStatus: string }>>();
  for (const event of importedHoldingEvents) {
    const matchedBatchId = recentBatchIds.find((batchId) => event.notes?.includes(importPrefixes.get(batchId) ?? ""));
    if (!matchedBatchId) {
      continue;
    }

    const bucket = holdingsByBatch.get(matchedBatchId) ?? [];
    if (!bucket.some((holding) => holding.id === event.holding.id)) {
      bucket.push(event.holding);
      holdingsByBatch.set(matchedBatchId, bucket);
    }
  }

  const importOverview = {
    batchCount: recentBatches.length,
    importedRows: recentBatches.reduce((sum, batch) => sum + (batch.processedCount ?? 0), 0),
    failedRows: recentBatches.reduce((sum, batch) => sum + (batch.errorCount ?? 0), 0),
    completedBatches: recentBatches.filter((batch) => batch.batchStatus === "COMPLETED").length,
    positionsCreated: recentBatchItemsPlaceholderCount(positionsByBatch),
    holdingsTouched: recentBatchItemsPlaceholderCount(holdingsByBatch),
  };

  const makeHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (validStatusFilter !== "all") {
      params.set("status", validStatusFilter);
    }
    if (selectedBrokerAccountId) {
      params.set("brokerAccountId", selectedBrokerAccountId);
    }
    if (fileQuery) {
      params.set("q", fileQuery);
    }
    if (fromValue) {
      params.set("from", fromValue);
    }
    if (toValue) {
      params.set("to", toValue);
    }
    if (failedOnlyFilter) {
      params.set("failedOnly", "1");
    }
    if (nextPage > 1) {
      params.set("page", String(nextPage));
    }

    const query = params.toString();
    return query ? `/imports?${query}` : "/imports";
  };

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
    positions: positionsByBatch.get(batch.id) ?? [],
    holdings: holdingsByBatch.get(batch.id) ?? [],
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

      <section className="panel section-stack">
        <div className="stats-grid-3">
          <label className="field-stack">
            <span className="field-label">Status</span>
            <select name="status" form="imports-filter-form" defaultValue={validStatusFilter} className="input-field">
              <option value="all">All Statuses</option>
              {Object.values(ImportBatchStatus).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field-stack">
            <span className="field-label">Broker Account</span>
            <select name="brokerAccountId" form="imports-filter-form" defaultValue={selectedBrokerAccountId} className="input-field">
              <option value="">All Accounts</option>
              {brokerOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="field-stack">
            <span className="field-label">File Name</span>
            <input name="q" form="imports-filter-form" defaultValue={fileQuery} className="input-field" placeholder="moomoo.csv" />
          </label>
        </div>
        <div className="stats-grid-3">
          <label className="field-stack">
            <span className="field-label">From</span>
            <input type="date" name="from" form="imports-filter-form" defaultValue={fromValue ?? ""} className="input-field" />
          </label>
          <label className="field-stack">
            <span className="field-label">To</span>
            <input type="date" name="to" form="imports-filter-form" defaultValue={toValue ?? ""} className="input-field" />
          </label>
          <label className="field-stack">
            <span className="field-label">Failed Rows</span>
            <select name="failedOnly" form="imports-filter-form" defaultValue={failedOnlyFilter ? "1" : "0"} className="input-field">
              <option value="0">Include All</option>
              <option value="1">Failed Only</option>
            </select>
          </label>
        </div>
        <form id="imports-filter-form" method="GET" action="/imports" className="hero-actions">
          <button type="submit" className="btn-primary">Apply Filters</button>
          <Link href="/imports" className="btn-ghost">Reset Filters</Link>
        </form>
      </section>

      <ImportHistoryPanel
        batches={recentBatchItems}
        overview={importOverview}
      />

      <PaginationControls
        page={meta.page}
        totalPages={meta.totalPages}
        totalCount={meta.totalCount}
        pageSize={meta.pageSize}
        makeHref={makeHref}
      />
    </main>
  );
}

function recentBatchItemsPlaceholderCount<T>(map: Map<string, T[]>) {
  let total = 0;
  for (const items of map.values()) {
    total += items.length;
  }
  return total;
}
