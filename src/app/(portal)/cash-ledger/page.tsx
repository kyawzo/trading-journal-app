import { NoticeToast } from "@/src/app/components/notice-toast";
import Link from "next/link";
import { CashTxnType, Prisma } from "@prisma/client";
import { PaginationControls } from "@/src/app/components/pagination-controls";
import { requireCurrentUser } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { attachRunningBalances, calculateCashLedgerSummary, formatCashTxnType } from "@/src/lib/cash-ledger";
import { paginationMeta, parsePositiveInt } from "@/src/lib/listing-pagination";
import { formatCurrency } from "@/src/lib/pnl";
import {
  formatActiveBrokerLabel,
  getBrokerScopedWhere,
  getWorkspacePreference,
} from "@/src/lib/workspace-preference";
import { CashLedgerEntryModal } from "./cash-ledger-entry-modal";

type PageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: string;
    page?: string;
    direction?: string;
    txnType?: string;
    q?: string;
    from?: string;
    to?: string;
  }>;
};

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

function formatDateTimeLocalInput(date: Date) {
  const localDate = new Date(date);
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  return localDate.toISOString().slice(0, 16);
}

export default async function CashLedgerPage({ searchParams }: PageProps) {
  const { notice, tone, page, direction, txnType, q, from, to } = await searchParams;
  await requireCurrentUser("/cash-ledger");
  const workspace = await getWorkspacePreference();
  const activeBrokerLabel = formatActiveBrokerLabel(workspace.activeBrokerAccount);
  const hasActiveBroker = Boolean(workspace.activeBrokerAccountId);
  const currentPage = parsePositiveInt(page, 1);
  const directionFilter = direction === "inflow" || direction === "outflow" ? direction : "all";
  const textQuery = (q ?? "").trim();
  const validTxnTypes = new Set(Object.values(CashTxnType));
  const txnTypeFilter = validTxnTypes.has((txnType ?? "") as CashTxnType) ? txnType as CashTxnType : "all";
  const defaultWindow = getDefaultDateWindow();
  const fromValue = from === undefined ? defaultWindow.from : from;
  const toValue = to === undefined ? defaultWindow.to : to;
  const fromDate = fromValue ? new Date(`${fromValue}T00:00:00`) : null;
  const toDate = toValue ? new Date(`${toValue}T23:59:59`) : null;

  const where: Prisma.CashLedgerWhereInput = {
    ...getBrokerScopedWhere(workspace.activeBrokerAccountId),
    ...(directionFilter === "inflow"
      ? { amount: { gt: 0 } }
      : directionFilter === "outflow"
        ? { amount: { lt: 0 } }
        : {}),
    ...(txnTypeFilter !== "all" ? { txnType: txnTypeFilter } : {}),
    ...(textQuery ? { description: { contains: textQuery, mode: "insensitive" } } : {}),
    ...((fromDate || toDate)
      ? {
        txnTimestamp: {
          ...(fromDate ? { gte: fromDate } : {}),
          ...(toDate ? { lte: toDate } : {}),
        },
      }
      : {}),
  };

  const totalCount = await prisma.cashLedger.count({ where });
  const meta = paginationMeta(totalCount, currentPage, PAGE_SIZE);

  const entries = await prisma.cashLedger.findMany({
    where,
    orderBy: [{ txnTimestamp: "desc" }, { createdAt: "desc" }],
    skip: meta.skip,
    take: meta.pageSize,
  });

  const summary = calculateCashLedgerSummary(entries);
  const entriesWithBalance = attachRunningBalances(entries).reverse();

  const makeHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (directionFilter !== "all") {
      params.set("direction", directionFilter);
    }
    if (txnTypeFilter !== "all") {
      params.set("txnType", txnTypeFilter);
    }
    if (textQuery) {
      params.set("q", textQuery);
    }
    if (fromValue) {
      params.set("from", fromValue);
    }
    if (toValue) {
      params.set("to", toValue);
    }
    if (nextPage > 1) {
      params.set("page", String(nextPage));
    }

    const query = params.toString();
    return query ? `/cash-ledger?${query}` : "/cash-ledger";
  };

  return (
    <main className="page-shell">
      <NoticeToast notice={notice} tone={tone} />

      <section className="hero-card">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Cash Ledger</p>
            <h2 className="page-title">Track the real cash moving through the active broker account.</h2>
            <p className="page-subtitle">
              Start with your opening balance, then add deposits, withdrawals, adjustments, dividends, interest, or fees.
              Your cash balance is derived from these broker-scoped ledger rows.
            </p>
            <div className="item-row mt-4">
              <span className="chip-neutral">Active Broker: {activeBrokerLabel}</span>
            </div>
          </div>

          <div className="hero-actions">
            <CashLedgerEntryModal
              activeBrokerLabel={activeBrokerLabel}
              defaultTimestamp={formatDateTimeLocalInput(new Date())}
              hasActiveBroker={hasActiveBroker}
            />
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Cash Snapshot</h3>
          <p className="section-copy">A simple view of cash totals for the currently filtered ledger rows.</p>
        </div>

        <div className="item-row">
          <Link href="/cash-ledger" className={directionFilter === "all" ? "btn-primary" : "btn-ghost"}>All</Link>
          <Link href="/cash-ledger?direction=inflow" className={directionFilter === "inflow" ? "btn-primary" : "btn-ghost"}>Inflows</Link>
          <Link href="/cash-ledger?direction=outflow" className={directionFilter === "outflow" ? "btn-primary" : "btn-ghost"}>Outflows</Link>
        </div>

        <form method="GET" action="/cash-ledger" className="panel section-stack">
          <input type="hidden" name="direction" value={directionFilter} />
          <div className="stats-grid-3">
            <label className="field-stack">
              <span className="field-label">Transaction Type</span>
              <select name="txnType" defaultValue={txnTypeFilter} className="input-field">
                <option value="all">All Types</option>
                {Object.values(CashTxnType).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">From</span>
              <input type="date" name="from" defaultValue={fromValue ?? ""} className="input-field" />
            </label>
            <label className="field-stack">
              <span className="field-label">To</span>
              <input type="date" name="to" defaultValue={toValue ?? ""} className="input-field" />
            </label>
          </div>
          <label className="field-stack mb-3">
            <span className="field-label">Description</span>
            <input name="q" defaultValue={textQuery} className="input-field" placeholder="Dividend, transfer, fee..." />
          </label>
          <div className="hero-actions mt-4">
            <button type="submit" className="btn-primary">Apply Filters</button>
            <Link href={directionFilter === "all" ? "/cash-ledger" : `/cash-ledger?direction=${directionFilter}`} className="btn-ghost">Reset Filters</Link>
          </div>
        </form>

        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Total Deposited</p>
            <p className="stat-value-positive">{formatCurrency(summary.totalDeposits, summary.currency)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Current Cash Balance</p>
            <p className={summary.currentBalance >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {formatCurrency(summary.currentBalance, summary.currency)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Total Inflows</p>
            <p className="stat-value-positive">{formatCurrency(summary.totalInflows, summary.currency)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Total Outflows</p>
            <p className="stat-value-negative">-{formatCurrency(summary.totalOutflows, summary.currency).replace("-", "")}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Ledger Entries</p>
            <p className="stat-value">{entries.length}</p>
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Recent Ledger Entries</h3>
          <p className="section-copy">Most recent cash movements, with a running balance after each row.</p>
        </div>

        {entriesWithBalance.length === 0 ? (
          <div className="empty-state">
            No cash entries yet for this broker account. Add a <strong>DEPOSIT</strong> first to record the opening balance.
          </div>
        ) : (
          <ul className="list-stack">
            {entriesWithBalance.map((entry) => (
              <li key={entry.id} className="list-card">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h4 className="item-title">{formatCashTxnType(entry.txnType)}</h4>
                    <p className="note mt-2">{new Date(entry.txnTimestamp).toLocaleString()}</p>
                    <div className="item-row mt-3">
                      <span className="chip-neutral">{activeBrokerLabel}</span>
                    </div>
                    {entry.description ? <p className="note mt-2">{entry.description}</p> : null}
                  </div>

                  <div className="space-y-2 text-right">
                    <p className={entry.signedAmount >= 0 ? "stat-value-positive text-2xl" : "stat-value-negative text-2xl"}>
                      {formatCurrency(entry.signedAmount, entry.currency)}
                    </p>
                    <p className="note">Running balance: {formatCurrency(entry.runningBalance, entry.currency)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <PaginationControls
          page={meta.page}
          totalPages={meta.totalPages}
          totalCount={meta.totalCount}
          pageSize={meta.pageSize}
          makeHref={makeHref}
        />
      </section>
    </main>
  );
}
