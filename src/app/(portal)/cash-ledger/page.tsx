import { NoticeToast } from "@/src/app/components/notice-toast";
import { requireCurrentUser } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { attachRunningBalances, calculateCashLedgerSummary, formatCashTxnType } from "@/src/lib/cash-ledger";
import { formatCurrency } from "@/src/lib/pnl";
import {
  formatActiveBrokerLabel,
  getBrokerScopedWhere,
  getWorkspacePreference,
} from "@/src/lib/workspace-preference";
import { CashLedgerEntryModal } from "./cash-ledger-entry-modal";

type PageProps = {
  searchParams: Promise<{ notice?: string; tone?: string }>;
};

function formatDateTimeLocalInput(date: Date) {
  const localDate = new Date(date);
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  return localDate.toISOString().slice(0, 16);
}

export default async function CashLedgerPage({ searchParams }: PageProps) {
  const { notice, tone } = await searchParams;
  await requireCurrentUser("/cash-ledger");
  const workspace = await getWorkspacePreference();
  const activeBrokerLabel = formatActiveBrokerLabel(workspace.activeBrokerAccount);
  const hasActiveBroker = Boolean(workspace.activeBrokerAccountId);

  const entries = await prisma.cashLedger.findMany({
    where: getBrokerScopedWhere(workspace.activeBrokerAccountId),
    orderBy: [{ txnTimestamp: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  const summary = calculateCashLedgerSummary(entries);
  const entriesWithBalance = attachRunningBalances(entries).reverse();

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
          <p className="section-copy">A simple running view of available cash based on recorded ledger entries.</p>
        </div>

        <div className="stats-grid">
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
      </section>
    </main>
  );
}
