"use client";

type BrokerAccount = {
  id: string;
  accountName: string;
  broker: {
    brokerName: string;
  };
};

type BrokerSelectorProps = {
  brokerAccounts: BrokerAccount[];
  activeBrokerAccountId: string | null;
};

export function BrokerSelector({ brokerAccounts, activeBrokerAccountId }: BrokerSelectorProps) {
  if (brokerAccounts.length === 0) {
    return (
      <p className="sidebar-context-empty">
        Create a broker account first to scope new trades and balances.
      </p>
    );
  }

  return (
    <form method="POST" action="/api/workspace-preferences" className="sidebar-context-form">
      <input type="hidden" name="intent" value="set-active-broker" />
      <select
        name="brokerAccountId"
        className="sidebar-select-field"
        defaultValue={activeBrokerAccountId ?? brokerAccounts[0]?.id}
        onChange={(e) => e.target.form?.submit()}
      >
        {brokerAccounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.broker.brokerName} · {account.accountName}
          </option>
        ))}
      </select>
    </form>
  );
}