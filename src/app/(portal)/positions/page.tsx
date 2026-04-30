import Link from "next/link";
import { PositionStatus, Prisma, StrategyType } from "@prisma/client";
import { PaginationControls } from "@/src/app/components/pagination-controls";
import { requireCurrentUser } from "@/src/lib/auth";
import { paginationMeta, parsePositiveInt } from "@/src/lib/listing-pagination";
import { prisma } from "@/src/lib/prisma";
import {
  formatActiveBrokerLabel,
  formatBrokerAccountLabel,
  getBrokerScopedWhere,
  getWorkspacePreference,
} from "@/src/lib/workspace-preference";

const PAGE_SIZE = 20;
const CLOSED_STATUSES: PositionStatus[] = [
  PositionStatus.CLOSED,
  PositionStatus.EXPIRED,
  PositionStatus.ASSIGNED,
  PositionStatus.EXERCISED,
];

function getPositionCardClassName(status: string): string {
  const closedStatuses = new Set(CLOSED_STATUSES.map((value) => value.toString()));
  return closedStatuses.has(status) ? "list-card list-card-closed" : "list-card list-card-open";
}

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

function getPositionSummary(position: any): string {
  if (position.positionTitle) {
    return position.positionTitle;
  }

  if (!position.legs || position.legs.length === 0) {
    return "No custom title yet. Open the detail page to add thesis, plans, and structure notes.";
  }

  // Only get OPEN legs (exclude ROLLED, CLOSED, etc.)
  const openLegs = position.legs.filter((leg: any) => leg.legStatus === "OPEN");
  
  if (openLegs.length === 0) {
    return "No custom title yet. Open the detail page to add thesis, plans, and structure notes.";
  }

  // Get PUT and CALL strikes from OPEN legs only
  const putLegs = openLegs.filter((leg: any) => leg.optionType === "PUT");
  const callLegs = openLegs.filter((leg: any) => leg.optionType === "CALL");

  const putStrikes = putLegs
    .map((leg: any) => leg.strikePrice)
    .filter(Boolean)
    .sort((a: any, b: any) => parseFloat(a) - parseFloat(b));

  const callStrikes = callLegs
    .map((leg: any) => leg.strikePrice)
    .filter(Boolean)
    .sort((a: any, b: any) => parseFloat(a) - parseFloat(b));

  // Build strike portions only if they have legs
  const strikePortions = [];
  
  if (putStrikes.length > 0) {
    strikePortions.push(`PUT SP - ${putStrikes.join("/")}`);
  }

  if (callStrikes.length > 0) {
    strikePortions.push(`CALL SP - ${callStrikes.join("/")}`);
  }

  // Get expiry date from OPEN legs
  const expiryLeg = openLegs.find((leg: any) => leg.expiryDate);
  let dteStr = "dd/mm/yyyy";
  if (expiryLeg && expiryLeg.expiryDate) {
    const expiryDate = new Date(expiryLeg.expiryDate);
    dteStr = expiryDate.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  // Get premium from the opening action (typically STO for most strategies)
  // For IC, CC, CSP, etc., the opening action is usually "STO"
  let premiumStr = "x.xx";
  if (position.actions && position.actions.length > 0) {
    // Filter for opening action type based on strategy
    let openingAction = null;
    
    // Most strategies use STO to open
    openingAction = position.actions.find((action: any) => action.actionType === "STO");
    
    // If no STO found, try BTO (for some strategies that buy to open)
    if (!openingAction) {
      openingAction = position.actions.find((action: any) => action.actionType === "BTO");
    }

    // If still not found, just use the first premium action
    if (!openingAction) {
      openingAction = position.actions.find((action: any) => action.premiumPerUnit !== null);
    }

    if (openingAction && openingAction.premiumPerUnit !== null) {
      premiumStr = parseFloat(openingAction.premiumPerUnit).toFixed(2);
    }
  }

  // Combine all parts
  const parts = [...strikePortions, `Premium - ${premiumStr}`, `DTE - ${dteStr}`];
  return parts.join(", ");
}

type PageProps = {
  searchParams: Promise<{
    page?: string;
    status?: string;
    q?: string;
    strategy?: string;
    from?: string;
    to?: string;
  }>;
};

export default async function PositionsPage({ searchParams }: PageProps) {
  const { page, status, q, strategy, from, to } = await searchParams;
  await requireCurrentUser("/positions");
  const workspace = await getWorkspacePreference();
  const currentPage = parsePositiveInt(page, 1);
  const statusFilter = status === "open" || status === "closed" ? status : "all";
  const symbolQuery = (q ?? "").trim().toUpperCase();
  const validStrategies = new Set(Object.values(StrategyType));
  const strategyFilter = validStrategies.has((strategy ?? "") as StrategyType) ? strategy as StrategyType : "all";
  const defaultWindow = getDefaultDateWindow();
  const fromValue = from === undefined ? defaultWindow.from : from;
  const toValue = to === undefined ? defaultWindow.to : to;
  const fromDate = fromValue ? new Date(`${fromValue}T00:00:00`) : null;
  const toDate = toValue ? new Date(`${toValue}T23:59:59`) : null;

  const where: Prisma.PositionWhereInput = {
    ...getBrokerScopedWhere(workspace.activeBrokerAccountId),
    ...(statusFilter === "open"
      ? { currentStatus: { notIn: CLOSED_STATUSES } }
      : statusFilter === "closed"
        ? { currentStatus: { in: CLOSED_STATUSES } }
        : {}),
    ...(symbolQuery ? { underlyingSymbol: { contains: symbolQuery, mode: "insensitive" } } : {}),
    ...(strategyFilter !== "all" ? { strategyType: strategyFilter } : {}),
    ...((fromDate || toDate)
      ? {
        openedAt: {
          ...(fromDate ? { gte: fromDate } : {}),
          ...(toDate ? { lte: toDate } : {}),
        },
      }
      : {}),
  };

  const makeFilterHref = (nextStatus: "all" | "open" | "closed") => {
    const params = new URLSearchParams();
    if (nextStatus !== "all") {
      params.set("status", nextStatus);
    }
    if (symbolQuery) {
      params.set("q", symbolQuery);
    }
    if (strategyFilter !== "all") {
      params.set("strategy", strategyFilter);
    }
    if (fromValue) {
      params.set("from", fromValue);
    }
    if (toValue) {
      params.set("to", toValue);
    }

    const query = params.toString();
    return query ? `/positions?${query}` : "/positions";
  };

  const totalCount = await prisma.position.count({ where });
  const meta = paginationMeta(totalCount, currentPage, PAGE_SIZE);

  const positions = await prisma.position.findMany({
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
      legs: true,
      actions: true,
    },
  });

  const makeHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }
    if (symbolQuery) {
      params.set("q", symbolQuery);
    }
    if (strategyFilter !== "all") {
      params.set("strategy", strategyFilter);
    }
    if (nextPage > 1) {
      params.set("page", String(nextPage));
    }

    const query = params.toString();
    return query ? `/positions?${query}` : "/positions";
  };

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Positions</p>
            <h2 className="page-title">Track every thesis, structure, and exit by broker account.</h2>
            <p className="page-subtitle">
              This list is scoped to the active broker account, so new positions and their downstream actions stay grouped correctly.
            </p>
            <div className="item-row mt-4">
              <span className="chip-neutral">Active Broker: {formatActiveBrokerLabel(workspace.activeBrokerAccount)}</span>
            </div>
          </div>

          <div className="hero-actions">
            <Link href="/positions/new" className="btn-primary">
              Create Position
            </Link>
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h3 className="section-heading">Recent Positions</h3>
          <p className="section-copy">Your latest manual and linked strategy entries for the selected broker account.</p>
        </div>

        <div className="item-row">
          <Link href={makeFilterHref("all")} className={statusFilter === "all" ? "btn-primary" : "btn-ghost"}>All</Link>
          <Link href={makeFilterHref("open")} className={statusFilter === "open" ? "btn-primary" : "btn-ghost"}>Open</Link>
          <Link href={makeFilterHref("closed")} className={statusFilter === "closed" ? "btn-primary" : "btn-ghost"}>Closed</Link>
        </div>

        <form method="GET" action="/positions" className="panel section-stack">
          <input type="hidden" name="status" value={statusFilter} />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="field-stack">
              <span className="field-label">Symbol</span>
              <input name="q" defaultValue={symbolQuery} className="input-field" placeholder="AAPL" />
            </label>
            <label className="field-stack">
              <span className="field-label">Strategy</span>
              <select name="strategy" defaultValue={strategyFilter} className="input-field">
                <option value="all">All Strategies</option>
                {Object.values(StrategyType).map((value) => (
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
            <Link href={makeFilterHref(statusFilter)} className="btn-ghost">Refresh Current Scope</Link>
            <Link href={statusFilter === "all" ? "/positions" : `/positions?status=${statusFilter}`} className="btn-ghost">Reset Filters</Link>
          </div>
        </form>

        {positions.length === 0 ? (
          <div className="empty-state">
            No positions found for this filter. Adjust status or create a new position.
          </div>
        ) : (
          <ul className="list-stack">
            {positions.map((position) => (
              <li key={position.id} className={getPositionCardClassName(position.currentStatus)}>
                <Link href={`/positions/${position.id}`} className="list-link">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h4 className="item-title">{position.underlyingSymbol} · {position.strategyType}</h4>
                      <p className="note mt-2 max-w-2xl">
                        {getPositionSummary(position)}
                      </p>
                    </div>

                    <div className="item-row">
                      <span className="chip">{position.currentStatus}</span>
                      <span className="chip-neutral">{position.assetClass}</span>
                      <span className="chip-neutral">{formatBrokerAccountLabel(position.brokerAccount)}</span>
                      <span className="chip-amber">{new Date(position.openedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </Link>
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
