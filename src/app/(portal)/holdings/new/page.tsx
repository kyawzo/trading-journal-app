import { NoticeToast } from "@/src/app/components/notice-toast";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ notice?: string; tone?: string }>;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field-stack">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function formatDateTimeLocalInput(date: Date) {
  const localDate = new Date(date);
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  return localDate.toISOString().slice(0, 16);
}

export default async function NewHoldingPage({ searchParams }: PageProps) {
  const { notice, tone } = await searchParams;

  return (
    <main className="page-shell">
      <NoticeToast notice={notice} tone={tone} />

      <section className="hero-card">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">New Holding</p>
            <h2 className="page-title font-[var(--font-body)]">Add stock you bought manually or transferred in.</h2>
            <p className="page-subtitle">
              Use this for stock positions that did not come from option assignment. The app will create the holding and
              its opening holding event together.
            </p>
          </div>

          <div className="hero-actions">
            <Link href="/holdings" className="btn-ghost">Back to Holdings</Link>
          </div>
        </div>
      </section>

      <section className="panel-strong section-stack">
        <div>
          <h3 className="section-heading">Manual Holding Entry</h3>
          <p className="section-copy">Start with the opening stock lot. You can add later sell/dividend/adjustment events from the detail page.</p>
        </div>

        <form method="POST" action="/api/holdings" className="space-y-4">
          <div className="form-grid">
            <Field label="Symbol">
              <input name="symbol" className="input-field" placeholder="AAPL" required />
            </Field>
            <Field label="Source Type">
              <select name="sourceType" defaultValue="MANUAL_BUY" className="select-field">
                <option value="MANUAL_BUY">Manual Buy</option>
                <option value="TRANSFER_IN">Transfer In</option>
                <option value="OTHER">Other</option>
              </select>
            </Field>
            <Field label="Opened At">
              <input name="openedAt" type="datetime-local" defaultValue={formatDateTimeLocalInput(new Date())} className="input-field" required />
            </Field>
            <Field label="Share Quantity">
              <input name="quantity" type="number" step="0.0001" className="input-field" required />
            </Field>
            <Field label="Cost Basis Per Share">
              <input name="costBasisPerShare" type="number" step="0.0001" className="input-field" required />
            </Field>
            <Field label="Opening Fee">
              <input name="feeAmount" type="number" step="0.01" defaultValue="0" className="input-field" />
            </Field>
          </div>

          <Field label="Notes">
            <textarea name="notes" rows={3} className="textarea-field min-h-24" placeholder="Manual stock buy, transfer from another broker, long-term core holding..." />
          </Field>

          <p className="note">
            Manual buys will create an <code>ACQUIRED</code> event and post stock cash outflow to the cash ledger.
            <code>TRANSFER_IN</code> creates the holding without cash movement. Currency is always taken from the active broker account.
          </p>

          <div className="hero-actions">
            <button className="btn-primary">Create Holding</button>
          </div>
        </form>
      </section>
    </main>
  );
}




