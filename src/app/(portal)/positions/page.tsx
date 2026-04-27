import Link from "next/link";
import { requireCurrentUser } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import {
  formatActiveBrokerLabel,
  formatBrokerAccountLabel,
  getBrokerScopedWhere,
  getWorkspacePreference,
} from "@/src/lib/workspace-preference";

function getPositionCardClassName(status: string): string {
  const closedStatuses = new Set(["CLOSED", "EXPIRED", "EXPIRED_WORTHLESS", "ASSIGNED"]);
  return closedStatuses.has(status) ? "list-card list-card-closed" : "list-card list-card-open";
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

export default async function PositionsPage() {
  await requireCurrentUser("/positions");
  const workspace = await getWorkspacePreference();
  const positions = await prisma.position.findMany({
    where: getBrokerScopedWhere(workspace.activeBrokerAccountId),
    orderBy: { openedAt: "desc" },
    take: 20,
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

        {positions.length === 0 ? (
          <div className="empty-state">
            No positions yet for this broker account. Start with a manual trade or launch one from a holding workflow.
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
      </section>
    </main>
  );
}
