import Link from "next/link";
import { CashTxnType } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { formatCashTxnType } from "@/src/lib/cash-ledger";
import { formatCurrency } from "@/src/lib/pnl";
import {
  formatActiveBrokerLabel,
  getWorkspacePreference,
} from "@/src/lib/workspace-preference";

type PageProps = {
  searchParams: Promise<{ year?: string }>;
};

const CAPITAL_INFLOW_TYPES = new Set<CashTxnType>([
  CashTxnType.DEPOSIT,
  CashTxnType.TRANSFER_IN,
]);

const CAPITAL_OUTFLOW_TYPES = new Set<CashTxnType>([
  CashTxnType.WITHDRAWAL,
  CashTxnType.TRANSFER_OUT,
]);

const INCOME_TYPES = new Set<CashTxnType>([
  CashTxnType.DIVIDEND,
  CashTxnType.INTEREST,
]);

const COST_TYPES = new Set<CashTxnType>([
  CashTxnType.FEE,
  CashTxnType.COMMISSION,
  CashTxnType.TAX,
]);

const ADJUSTMENT_TYPES = new Set<CashTxnType>([
  CashTxnType.ADJUSTMENT,
  CashTxnType.OTHER,
]);

function monthKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  const labelDate = new Date(Number(year), Number(month) - 1, 1);
  return labelDate.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (typeof value === "object" && value !== null && "toString" in value) {
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export default async function CashFlowReportPage({ searchParams }: PageProps) {
  const { year } = await searchParams;
  const workspace = await getWorkspacePreference();

  if (!workspace.activeBrokerAccountId) {
    return (
      <main className="page-shell section-stack">
        <section className="hero-card section-stack">
          <div>
            <p className="eyebrow">Cash Flow Report</p>
            <h2 className="page-title">Broker cash movement overview</h2>
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

  const allEntries = await prisma.cashLedger.findMany({
    where: {
      brokerAccountId: workspace.activeBrokerAccountId,
    },
    select: {
      txnType: true,
      amount: true,
      currency: true,
      txnTimestamp: true,
    },
    orderBy: [{ txnTimestamp: "asc" }],
  });

  const availableYears = Array.from(
    new Set(allEntries.map((entry) => entry.txnTimestamp.getFullYear())),
  ).sort((a, b) => b - a);

  const selectedYear = year ? Number(year) : availableYears[0] ?? new Date().getFullYear();
  const filteredEntries = allEntries.filter((entry) => entry.txnTimestamp.getFullYear() === selectedYear);
  const reportCurrency = filteredEntries[0]?.currency ?? allEntries[0]?.currency ?? workspace.activeBrokerAccount?.baseCurrency ?? "USD";

  let periodNetCashFlow = 0;
  let capitalAdded = 0;
  let capitalRemoved = 0;
  let optionsPremiumNet = 0;
  let stockTradeNet = 0;
  let incomeTotal = 0;
  let feesAndTaxes = 0;
  let adjustments = 0;

  const categoryMap = new Map<CashTxnType, number>();
  const monthlyMap = new Map<string, { net: number; entries: number }>();

  for (const entry of filteredEntries) {
    const amount = toNumber(entry.amount);
    periodNetCashFlow += amount;

    categoryMap.set(entry.txnType, (categoryMap.get(entry.txnType) ?? 0) + amount);

    if (CAPITAL_INFLOW_TYPES.has(entry.txnType)) {
      capitalAdded += amount;
    } else if (CAPITAL_OUTFLOW_TYPES.has(entry.txnType)) {
      capitalRemoved += Math.abs(amount);
    } else if (entry.txnType === CashTxnType.OPTIONS_PREMIUM) {
      optionsPremiumNet += amount;
    } else if (entry.txnType === CashTxnType.STOCK_PURCHASE || entry.txnType === CashTxnType.STOCK_SALE) {
      stockTradeNet += amount;
    } else if (INCOME_TYPES.has(entry.txnType)) {
      incomeTotal += amount;
    } else if (COST_TYPES.has(entry.txnType)) {
      feesAndTaxes += Math.abs(amount);
    } else if (ADJUSTMENT_TYPES.has(entry.txnType)) {
      adjustments += amount;
    }

    const key = monthKey(entry.txnTimestamp);
    const current = monthlyMap.get(key) ?? { net: 0, entries: 0 };
    current.net += amount;
    current.entries += 1;
    monthlyMap.set(key, current);
  }

  const categoryRows = Array.from(categoryMap.entries())
    .map(([txnType, amount]) => ({
      txnType,
      amount,
      count: filteredEntries.filter((entry) => entry.txnType === txnType).length,
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  const monthlyRows = Array.from(monthlyMap.entries())
    .map(([month, value]) => ({ month, ...value }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const bestMonth = monthlyRows.reduce<{ month: string; net: number } | null>(
    (best, row) => (!best || row.net > best.net ? { month: row.month, net: row.net } : best),
    null,
  );
  const worstMonth = monthlyRows.reduce<{ month: string; net: number } | null>(
    (worst, row) => (!worst || row.net < worst.net ? { month: row.month, net: row.net } : worst),
    null,
  );

  return (
    <main className="page-shell section-stack">
      <section className="hero-card section-stack">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Cash Flow Report</p>
            <h2 className="page-title">Money in, money out, and broker cash drivers</h2>
            <p className="page-subtitle">
              Review how deposits, withdrawals, premiums, stock trades, income, and costs changed cash for the selected year.
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
        <div className="item-row">
          {availableYears.length === 0 ? (
            <span className="chip-amber">No cash ledger rows yet</span>
          ) : (
            availableYears.map((y) => (
              <Link
                key={y}
                href={y === availableYears[0] ? "/reports/cash-flow" : `/reports/cash-flow?year=${y}`}
                className={selectedYear === y ? "btn-primary" : "btn-ghost"}
              >
                {y}
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="section-stack">
        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Period Net Cash Flow</p>
            <p className={periodNetCashFlow >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {formatCurrency(periodNetCashFlow, reportCurrency)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Capital Added</p>
            <p className="stat-value-positive">{formatCurrency(capitalAdded, reportCurrency)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Capital Removed</p>
            <p className="stat-value-negative">-{formatCurrency(capitalRemoved, reportCurrency).replace("-", "")}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Ledger Entries</p>
            <p className="stat-value">{filteredEntries.length}</p>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Options Premium Net</p>
            <p className={optionsPremiumNet >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {formatCurrency(optionsPremiumNet, reportCurrency)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Stock Trade Net</p>
            <p className={stockTradeNet >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {formatCurrency(stockTradeNet, reportCurrency)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Income</p>
            <p className="stat-value-positive">{formatCurrency(incomeTotal, reportCurrency)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Fees & Taxes</p>
            <p className="stat-value-negative">-{formatCurrency(feesAndTaxes, reportCurrency).replace("-", "")}</p>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Adjustments / Other</p>
            <p className={adjustments >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {formatCurrency(adjustments, reportCurrency)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Best Month</p>
            <p className={bestMonth && bestMonth.net >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {bestMonth ? `${monthLabel(bestMonth.month)} · ${formatCurrency(bestMonth.net, reportCurrency)}` : "-"}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Worst Month</p>
            <p className={worstMonth && worstMonth.net >= 0 ? "stat-value-positive" : "stat-value-negative"}>
              {worstMonth ? `${monthLabel(worstMonth.month)} · ${formatCurrency(worstMonth.net, reportCurrency)}` : "-"}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Active Cash Months</p>
            <p className="stat-value">{monthlyRows.length}</p>
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Cash Categories</h3>
          <p className="section-copy">Each transaction type grouped to show which cash drivers mattered most in the selected year.</p>
        </div>

        {categoryRows.length === 0 ? (
          <div className="empty-state">No cash ledger activity found for {selectedYear}.</div>
        ) : (
          <ul className="list-stack">
            {categoryRows.map((row) => (
              <li key={row.txnType} className="list-card">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="item-title">{formatCashTxnType(row.txnType)}</h4>
                    <p className="note mt-2">{row.count} ledger entr{row.count === 1 ? "y" : "ies"}</p>
                  </div>
                  <p className={row.amount >= 0 ? "stat-value-positive" : "stat-value-negative"}>
                    {formatCurrency(row.amount, reportCurrency)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Monthly Breakdown</h3>
          <p className="section-copy">Net cash movement by month for the selected year.</p>
        </div>

        {monthlyRows.length === 0 ? (
          <div className="empty-state">No monthly cash movement found for {selectedYear}.</div>
        ) : (
          <ul className="list-stack">
            {monthlyRows.map((row) => (
              <li key={row.month} className="list-card">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="item-title">{monthLabel(row.month)}</h4>
                    <p className="note mt-2">{row.entries} ledger entr{row.entries === 1 ? "y" : "ies"}</p>
                  </div>
                  <p className={row.net >= 0 ? "stat-value-positive" : "stat-value-negative"}>
                    {formatCurrency(row.net, reportCurrency)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
