"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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
};

export function HoldingsListTabs({ holdings }: HoldingsListTabsProps) {
  const [activeTab, setActiveTab] = useState<"active" | "inactive">("active");

  const { activeHoldings, inactiveHoldings } = useMemo(() => {
    const active = holdings.filter((holding) => holding.remainingQuantityValue > 0);
    const inactive = holdings.filter((holding) => holding.remainingQuantityValue <= 0);

    return {
      activeHoldings: active,
      inactiveHoldings: inactive,
    };
  }, [holdings]);

  const visibleHoldings = activeTab === "active" ? activeHoldings : inactiveHoldings;

  return (
    <div className="section-stack">
      <div className="hero-actions">
        <button
          type="button"
          className={activeTab === "active" ? "btn-primary" : "btn-ghost"}
          onClick={() => setActiveTab("active")}
        >
          Active Holdings ({activeHoldings.length})
        </button>
        <button
          type="button"
          className={activeTab === "inactive" ? "btn-secondary" : "btn-ghost"}
          onClick={() => setActiveTab("inactive")}
        >
          Inactive Holdings ({inactiveHoldings.length})
        </button>
      </div>

      {visibleHoldings.length === 0 ? (
        <div className="empty-state">
          {activeTab === "active"
            ? "No active holdings right now."
            : "No inactive holdings yet."}
        </div>
      ) : (
        <ul className="list-stack">
          {visibleHoldings.map((holding) => {
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
                        {holding.remainingQuantityLabel} shares remaining · open cost {holding.openCostDisplay} · avg cost {holding.avgCostDisplay}/share
                      </p>
                    </div>

                    <div className="item-row">
                      <span className="chip">{holding.holdingStatus}</span>
                      <span className="chip-neutral">{holding.sourceType}</span>
                      <span className="chip-neutral">{holding.brokerLabel}</span>
                      <span className="chip-amber">{holding.openedAtDisplay}</span>
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
