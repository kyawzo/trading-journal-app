"use client";

import Link from "next/link";

type HoldingListItem = {
  id: string;
  symbol: string;
  remainingQuantityLabel: string;
  remainingQuantityValue: number;
  holdingStatus: string;
  sourceType: string;
  brokerLabel: string;
  openedAtDisplay: string;
  openCostDisplay: string;
  avgCostDisplay: string;
};

type HoldingsListTabsProps = {
  holdings: HoldingListItem[];
  activeTab: "active" | "inactive";
  activeHref: string;
  inactiveHref: string;
};

export function HoldingsListTabs({ holdings, activeTab, activeHref, inactiveHref }: HoldingsListTabsProps) {
  return (
    <div className="section-stack">
      <div className="hero-actions">
        <Link href={activeHref} className={activeTab === "active" ? "btn-primary" : "btn-ghost"}>Active Holdings</Link>
        <Link href={inactiveHref} className={activeTab === "inactive" ? "btn-secondary" : "btn-ghost"}>Inactive Holdings</Link>
      </div>

      {holdings.length === 0 ? (
        <div className="empty-state">
          {activeTab === "active"
            ? "No active holdings right now."
            : "No inactive holdings yet."}
        </div>
      ) : (
        <ul className="list-stack">
          {holdings.map((holding) => {
            const isInactive = holding.remainingQuantityValue <= 0;

            return (
              <li
                key={holding.id}
                className={`list-card transition-opacity ${isInactive ? "opacity-65" : "opacity-100"}`}
              >
                <Link href={`/holdings/${holding.id}`} className="list-link">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h4 className="item-title">{holding.symbol}</h4>
                      <p className="note mt-2">
                        {holding.remainingQuantityLabel} shares remaining · open cost {holding.openCostDisplay} · avg cost {holding.avgCostDisplay}/share · opened {holding.openedAtDisplay}
                      </p>
                    </div>

                    <div className="item-row">
                      <span className="chip">{holding.holdingStatus}</span>
                      <span className="chip-neutral">{holding.sourceType}</span>
                      <span className="chip-neutral">{holding.brokerLabel}</span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
