import Link from "next/link";
import { redirect } from "next/navigation";
import { NoticeToast } from "@/src/app/components/notice-toast";
import { requireCurrentUser, safeRedirectPath } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

const BROKER_OPTIONS = [
  { value: "MOOMOO", label: "MooMoo" },
  { value: "TIGER", label: "Tiger" },
  { value: "IBKR", label: "Interactive Brokers" },
  { value: "TASTYTRADE", label: "tastytrade" },
  { value: "WEBULL", label: "Webull" },
  { value: "MANUAL", label: "Manual Broker" },
] as const;

function formatDateInputValue(date: Date) {
  return new Date(date).toISOString().slice(0, 10);
}

type PageProps = {
  searchParams: Promise<{ notice?: string; tone?: string; next?: string }>;
};

export default async function OnboardingPage({ searchParams }: PageProps) {
  const { notice, tone, next } = await searchParams;
  const user = await requireCurrentUser("/onboarding");
  const safeNextPath = safeRedirectPath(next, "/dashboard");
  const nextPath = safeNextPath === "/onboarding" ? "/dashboard" : safeNextPath;

  const brokerAccountCount = await prisma.brokerAccount.count({
    where: { userId: user.id },
  });

  if (brokerAccountCount > 0) {
    redirect(nextPath);
  }

  return (
    <main className="page-shell">
      <NoticeToast notice={notice} tone={tone} />

      <section className="hero-card">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Onboarding</p>
            <h1 className="page-title font-[var(--font-body)]">Create your first broker account before you enter the journal.</h1>
            <p className="page-subtitle">
              Your trades, holdings, cash ledger, and broker context all hang off this first account. You can add more accounts later, but this gets your workspace ready now.
            </p>
            <div className="item-row mt-4">
              <span className="chip-neutral">Signed in as {user.email}</span>
              <span className="chip-amber">Step 1 of 1</span>
            </div>
          </div>

          <div className="hero-actions">
            <Link href={nextPath} className="btn-ghost">Skip for Now</Link>
          </div>
        </div>
      </section>

      <section className="section-stack lg:grid lg:grid-cols-[1.2fr,0.8fr] lg:items-start lg:gap-6 lg:space-y-0">
        <section className="panel-strong section-stack">
          <div>
            <p className="eyebrow">Broker Account</p>
            <h2 className="section-heading">Set up your account context</h2>
            <p className="section-copy">This account becomes the active broker automatically, and you can optionally seed the opening cash balance right away.</p>
          </div>

          <form method="POST" action="/api/broker-accounts" className="space-y-4">
            <input type="hidden" name="setAsActive" value="true" />
            <input type="hidden" name="errorRedirectTo" value={`/onboarding?next=${encodeURIComponent(nextPath)}`} />
            <input type="hidden" name="successRedirectTo" value={nextPath} />

            <div className="form-grid">
              <label className="field-stack">
                <span className="field-label">Broker</span>
                <select name="brokerCode" className="select-field" defaultValue="" required>
                  <option value="" disabled hidden>Select broker</option>
                  {BROKER_OPTIONS.map((broker) => (
                    <option key={broker.value} value={broker.value}>{broker.label}</option>
                  ))}
                </select>
              </label>

              <label className="field-stack">
                <span className="field-label">Account Name</span>
                <input name="accountName" className="input-field" placeholder="Main Wheel Account" required />
              </label>

              <label className="field-stack">
                <span className="field-label">Account Type</span>
                <select name="accountType" className="select-field" defaultValue="MARGIN">
                  <option value="CASH">CASH</option>
                  <option value="MARGIN">MARGIN</option>
                  <option value="PAPER">PAPER</option>
                  <option value="RETIREMENT">RETIREMENT</option>
                  <option value="OTHER">OTHER</option>
                </select>
              </label>

              <label className="field-stack">
                <span className="field-label">Base Currency</span>
                <select name="baseCurrency" className="select-field" defaultValue="USD">
                  <option value="USD">USD</option>
                  <option value="SGD">SGD</option>
                </select>
              </label>

              <label className="field-stack">
                <span className="field-label">Masked Account Number</span>
                <input name="accountNumberMasked" className="input-field" placeholder="••••1234" />
              </label>

              <label className="field-stack">
                <span className="field-label">Opened At</span>
                <input name="openedAt" type="date" className="input-field" defaultValue={formatDateInputValue(new Date())} />
              </label>
            </div>

            <label className="field-stack">
              <span className="field-label">Opening Balance</span>
              <input
                name="openingBalance"
                type="number"
                step="0.01"
                min="0"
                className="input-field"
                placeholder="Optional deposit amount"
              />
            </label>

            <label className="field-stack">
              <span className="field-label">Notes</span>
              <textarea
                name="notes"
                rows={3}
                className="textarea-field min-h-24"
                placeholder="Wheel account, retirement account, test account, long-term portfolio..."
              />
            </label>

            <p className="note">
              If you enter an opening balance, it will be saved as a <strong>DEPOSIT</strong> cash ledger entry so your account starts with a real cash baseline.
            </p>

            <div className="hero-actions">
              <button className="btn-primary">Finish Setup</button>
              <Link href={nextPath} className="btn-ghost">I&apos;ll Do This Later</Link>
            </div>
          </form>
        </section>

        <section className="section-stack">
          <div className="panel section-stack">
            <div>
              <p className="eyebrow">What Happens Next</p>
              <h2 className="section-heading">Your workspace becomes broker-aware immediately.</h2>
            </div>

            <ul className="list-stack">
              <li className="list-card">
                <h3 className="item-title">Active broker is set automatically</h3>
                <p className="note mt-2">New positions, holdings, and manual cash entries will inherit this account.</p>
              </li>
              <li className="list-card">
                <h3 className="item-title">Opening cash starts cleanly</h3>
                <p className="note mt-2">An optional opening balance becomes the first ledger deposit instead of hidden state.</p>
              </li>
              <li className="list-card">
                <h3 className="item-title">More accounts can come later</h3>
                <p className="note mt-2">You can add additional broker accounts from the Broker Accounts page whenever you need them.</p>
              </li>
            </ul>
          </div>
        </section>
      </section>
    </main>
  );
}
