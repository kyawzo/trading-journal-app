import { prisma } from "@/src/lib/prisma";
import { requireCurrentUser } from "@/src/lib/auth";
import { getWorkspacePreference } from "@/src/lib/workspace-preference";
import { BrokerSelector } from "./broker-selector";
import { PortalNav } from "./portal-nav";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireCurrentUser("/dashboard");

  const [workspace, brokerAccounts] = await Promise.all([
    getWorkspacePreference(),
    prisma.brokerAccount.findMany({
      where: {
        isActive: true,
        userId: user.id,
      },
      orderBy: [{ createdAt: "desc" }],
      include: {
        broker: true,
      },
    }),
  ]);

  return (
    <div className="portal-shell">
      <aside className="portal-sidebar">
        <div className="portal-brand-block">
          <p className="brand-kicker !text-[var(--sidebar-muted)]">Trading Journal</p>
        </div>

        <section className="sidebar-context">
          <p className="portal-nav-heading">Active Broker</p>

          <BrokerSelector
            brokerAccounts={brokerAccounts}
            activeBrokerAccountId={workspace.activeBrokerAccountId}
          />
        </section>

        <PortalNav userEmail={user.email} />
      </aside>

      <div className="portal-main-shell">
        <div className="portal-content">{children}</div>
      </div>
    </div>
  );
}
