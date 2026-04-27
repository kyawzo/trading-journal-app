import { NoticeToast } from "@/src/app/components/notice-toast";
import { BrokerAccountModal } from "./broker-account-modal";
import { requireCurrentUser } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { formatCurrency } from "@/src/lib/pnl";
import { formatActiveBrokerLabel, getWorkspacePreference } from "@/src/lib/workspace-preference";

type PageProps = {
  searchParams: Promise<{ notice?: string; tone?: string }>;
};

function formatDateInputValue(date: Date) {
  return new Date(date).toISOString().slice(0, 10);
}

export default async function BrokerAccountsPage({ searchParams }: PageProps) {
  const { notice, tone } = await searchParams;
  const user = await requireCurrentUser("/broker-accounts");
  const workspace = await getWorkspacePreference();

  const brokerAccounts = await prisma.brokerAccount.findMany({
    where: { userId: user.id },
    orderBy: [
      { isActive: "desc" },
      { createdAt: "desc" },
    ],
    include: {
      broker: true,
      positions: {
        select: {
          id: true,
          currentStatus: true,
        },
      },
      _count: {
        select: {
          positions: true,
        },
      },
    },
  });

  const holdings = await prisma.holding.findMany({
    where: {
      brokerAccountId: {
        in: brokerAccounts.map((account) => account.id),
      },
    },
    select: {
      brokerAccountId: true,
      remainingQuantity: true,
    },
  });

  const ledgerEntries = await prisma.cashLedger.findMany({
    where: {
      brokerAccountId: {
        in: brokerAccounts.map((account) => account.id),
      },
    },
    select: {
      brokerAccountId: true,
      amount: true,
      currency: true,
    },
  });

  const accountCards = brokerAccounts.map((account) => {
    const accountHoldings = holdings.filter((holding) => holding.brokerAccountId === account.id);
    const accountEntries = ledgerEntries.filter((entry) => entry.brokerAccountId === account.id);
    const activePositions = account.positions.filter((position) => position.currentStatus !== "CLOSED").length;
    const activeHoldings = accountHoldings.filter((holding) => Number(holding.remainingQuantity.toString()) > 0).length;
    const currentBalance = accountEntries.reduce((sum, entry) => sum + Number(entry.amount.toString()), 0);
    const currency = accountEntries[0]?.currency ?? account.baseCurrency;

    return {
      id: account.id,
      brokerName: account.broker.brokerName,
      accountName: account.accountName,
      accountType: account.accountType,
      currentBalance,
      currency,
      activePositions,
      activeHoldings,
      isCurrent: workspace.activeBrokerAccountId === account.id,
      openedAt: account.openedAt,
      accountNumberMasked: account.accountNumberMasked,
      baseCurrency: account.baseCurrency,
      notes: account.notes,
    };
  });

  return (
    <main className="page-shell">
      <NoticeToast notice={notice} tone={tone} />

      <section className="hero-card">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Broker Accounts</p>
            <h2 className="page-title font-[var(--font-body)]">Manage the account context behind every trade.</h2>
            <p className="page-subtitle">
              Choose the active broker account once, then new positions, holdings, and manual cash entries flow into that account automatically. You can also seed an opening balance during account creation now.
            </p>
            <div className="item-row mt-4">
              <span className="chip-neutral">Active: {formatActiveBrokerLabel(workspace.activeBrokerAccount)}</span>
            </div>
          </div>

          <div className="hero-actions">
            <BrokerAccountModal defaultOpenedAt={formatDateInputValue(new Date())} />
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Existing Accounts</h3>
          <p className="section-copy">Cash balance, active positions, active holdings, and any opening balance deposit are shown per broker account.</p>
        </div>

        {accountCards.length === 0 ? (
          <div className="empty-state">No broker accounts yet. Create your first account to start scoping trades and balances properly.</div>
        ) : (
          <ul className="list-stack">
            {accountCards.map((account) => (
              <li key={account.id} className="list-card section-stack">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h4 className="item-title">{account.brokerName} · {account.accountName}</h4>
                    <p className="note mt-2">{account.accountType} account · base {account.baseCurrency}{account.accountNumberMasked ? ` · ${account.accountNumberMasked}` : ""}</p>
                  </div>

                  <div className="item-row">
                    {account.isCurrent ? <span className="chip">ACTIVE</span> : null}
                    <span className="chip-neutral">{account.accountType}</span>
                    <span className="chip-amber">{formatCurrency(account.currentBalance, account.currency)}</span>
                  </div>
                </div>

                <div className="stats-grid-3">
                  <div className="stat-card">
                    <p className="stat-label">Cash Balance</p>
                    <p className={account.currentBalance >= 0 ? "stat-value-positive" : "stat-value-negative"}>{formatCurrency(account.currentBalance, account.currency)}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-label">Open Positions</p>
                    <p className="stat-value">{account.activePositions}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-label">Active Holdings</p>
                    <p className="stat-value">{account.activeHoldings}</p>
                  </div>
                </div>

                {account.notes ? <p className="note">{account.notes}</p> : null}

                {!account.isCurrent ? (
                  <form method="POST" action="/api/workspace-preferences" className="hero-actions">
                    <input type="hidden" name="intent" value="set-active-broker" />
                    <input type="hidden" name="brokerAccountId" value={account.id} />
                    <button className="btn-secondary">Set As Active Broker</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

