import Link from "next/link";
import { HoldingSourceType, Prisma } from "@prisma/client";
import { PaginationControls } from "@/src/app/components/pagination-controls";
import { requireCurrentUser } from "@/src/lib/auth";
import { paginationMeta, parsePositiveInt } from "@/src/lib/listing-pagination";
import { prisma } from "@/src/lib/prisma";
import { formatCurrency, formatNumber } from "@/src/lib/pnl";
import {
  formatActiveBrokerLabel,
  formatBrokerAccountLabel,
  getBrokerScopedWhere,
  getWorkspacePreference,
} from "@/src/lib/workspace-preference";
import { HoldingsListTabs } from "./holdings-list-tabs";
import { HoldingsPageModal } from "./holdings-page-modal";

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

type PageProps = {
  searchParams: Promise<{
    page?: string;
    tab?: string;
    q?: string;
    source?: string;
    from?: string;
    to?: string;
  }>;
};

export default async function HoldingsPage({ searchParams }: PageProps) {
  const { page, tab, q, source, from, to } = await searchParams;
  await requireCurrentUser("/holdings");
  const workspace = await getWorkspacePreference();
  const activeBrokerLabel = formatActiveBrokerLabel(workspace.activeBrokerAccount);
  const hasActiveBroker = Boolean(workspace.activeBrokerAccountId);
  const currentPage = parsePositiveInt(page, 1);
  const tabFilter = tab === "inactive" ? "inactive" : "active";
  const symbolQuery = (q ?? "").trim().toUpperCase();
  const validSources = new Set(Object.values(HoldingSourceType));
  const sourceFilter = validSources.has((source ?? "") as HoldingSourceType) ? source as HoldingSourceType : "all";
  const defaultWindow = getDefaultDateWindow();
  const fromValue = from === undefined ? defaultWindow.from : from;
  const toValue = to === undefined ? defaultWindow.to : to;
  const fromDate = fromValue ? new Date(`${fromValue}T00:00:00`) : null;
  const toDate = toValue ? new Date(`${toValue}T23:59:59`) : null;

  const where: Prisma.HoldingWhereInput = {
    ...getBrokerScopedWhere(workspace.activeBrokerAccountId),
    ...(tabFilter === "active" ? { remainingQuantity: { gt: 0 } } : { remainingQuantity: { lte: 0 } }),
    ...(symbolQuery ? { symbol: { contains: symbolQuery, mode: "insensitive" } } : {}),
    ...(sourceFilter !== "all" ? { sourceType: sourceFilter } : {}),
    ...((fromDate || toDate)
      ? {
        openedAt: {
          ...(fromDate ? { gte: fromDate } : {}),
          ...(toDate ? { lte: toDate } : {}),
        },
      }
      : {}),
  };

  const makeTabHref = (nextTab: "active" | "inactive") => {
    const params = new URLSearchParams();
    if (nextTab !== "active") {
      params.set("tab", nextTab);
    }
    if (symbolQuery) {
      params.set("q", symbolQuery);
    }
    if (sourceFilter !== "all") {
      params.set("source", sourceFilter);
    }
    if (fromValue) {
      params.set("from", fromValue);
    }
    if (toValue) {
      params.set("to", toValue);
    }

    const query = params.toString();
    return query ? `/holdings?${query}` : "/holdings";
  };

  const totalCount = await prisma.holding.count({ where });
  const meta = paginationMeta(totalCount, currentPage, PAGE_SIZE);

  const holdings = await prisma.holding.findMany({
    where,
    orderBy: { openedAt: "desc" },
    skip: meta.skip,
    take: meta.pageSize,
    include: {
      brokerAccount: {
        include: {
          broker: true,
        },
      },
      pnlSnapshot: {
        select: {
          currency: true,
          estimatedOpenCost: true,
          effectiveCostBasisPerShare: true,
        },
      },
    },
  });

  const holdingCards = holdings.map((holding) => {
    const remainingQuantityValue = Number(holding.remainingQuantity.toString());
    const estimatedOpenCost = Number(holding.pnlSnapshot?.estimatedOpenCost?.toString() ?? 0);
    const fallbackCostBasisPerShare = Number(holding.costBasisPerShare.toString());
    const avgCostPerShare = remainingQuantityValue > 0
      ? estimatedOpenCost / remainingQuantityValue
      : Number(holding.pnlSnapshot?.effectiveCostBasisPerShare?.toString() ?? fallbackCostBasisPerShare);
    const summaryCurrency = holding.pnlSnapshot?.currency ?? holding.brokerAccount?.baseCurrency ?? "USD";

    return {
      id: holding.id,
      symbol: holding.symbol,
      remainingQuantityLabel: formatNumber(remainingQuantityValue),
      remainingQuantityValue,
      holdingStatus: holding.holdingStatus,
      sourceType: holding.sourceType,
      brokerLabel: formatBrokerAccountLabel(holding.brokerAccount),
      openedAtDisplay: new Date(holding.openedAt).toLocaleDateString(),
      openCostDisplay: formatCurrency(estimatedOpenCost, summaryCurrency),
      avgCostDisplay: formatCurrency(avgCostPerShare, summaryCurrency),
    };
  });

  const makeHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (tabFilter !== "active") {
      params.set("tab", tabFilter);
    }
    if (symbolQuery) {
      params.set("q", symbolQuery);
    }
    if (sourceFilter !== "all") {
      params.set("source", sourceFilter);
    }
    if (nextPage > 1) {
      params.set("page", String(nextPage));
    }

    const query = params.toString();
    return query ? `/holdings?${query}` : "/holdings";
  };

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Holdings</p>
            <h2 className="page-title">See the stock layer behind each broker account.</h2>
            <p className="page-subtitle">
              Follow assigned shares, manual stock entries, linked covered calls, event history, and holding-level cost snapshots for the active broker.
            </p>
            <div className="item-row mt-4">
              <span className="chip-neutral">Active Broker: {activeBrokerLabel}</span>
            </div>
          </div>

          <div className="hero-actions">
            <HoldingsPageModal
              activeBrokerLabel={activeBrokerLabel}
              defaultOpenedAt={formatDateTimeLocalInput(new Date())}
              hasActiveBroker={hasActiveBroker}
            />
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Current Holdings</h3>
          <p className="section-copy">Track active stock inventory separately from holdings that are already closed or archived.</p>
        </div>

        <div className="item-row">
          <Link href={makeTabHref("active")} className={tabFilter === "active" ? "btn-primary" : "btn-ghost"}>Active</Link>
          <Link href={makeTabHref("inactive")} className={tabFilter === "inactive" ? "btn-primary" : "btn-ghost"}>Inactive</Link>
        </div>

        <form method="GET" action="/holdings" className="panel section-stack">
          <input type="hidden" name="tab" value={tabFilter} />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="field-stack">
              <span className="field-label">Symbol</span>
              <input name="q" defaultValue={symbolQuery} className="input-field" placeholder="AAPL" />
            </label>
            <label className="field-stack">
              <span className="field-label">Source</span>
              <select name="source" defaultValue={sourceFilter} className="input-field">
                <option value="all">All Sources</option>
                {Object.values(HoldingSourceType).map((value) => (
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
          <div className="hero-actions">
            <button type="submit" className="btn-primary">Apply Filters</button>
            <Link href={tabFilter === "active" ? "/holdings" : `/holdings?tab=${tabFilter}`} className="btn-ghost">Reset Filters</Link>
          </div>
        </form>

        {holdingCards.length === 0 ? (
          <div className="empty-state">
            No holdings found for this filter. Adjust tab or create a holding manually.
          </div>
        ) : (
          <HoldingsListTabs
            holdings={holdingCards}
            activeTab={tabFilter}
            activeHref={makeTabHref("active")}
            inactiveHref={makeTabHref("inactive")}
          />
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
