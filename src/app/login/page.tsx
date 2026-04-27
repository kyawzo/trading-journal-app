import Link from "next/link";
import { redirect } from "next/navigation";
import { NoticeToast } from "@/src/app/components/notice-toast";
import { getCurrentUser, safeRedirectPath } from "@/src/lib/auth";
import { LoginForm } from "./login-form";

type PageProps = {
  searchParams: Promise<{ notice?: string; tone?: string; next?: string }>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const { notice, tone, next } = await searchParams;
  const currentUser = await getCurrentUser();
  const nextPath = safeRedirectPath(next, "/dashboard");

  if (currentUser) {
    redirect(nextPath);
  }

  return (
    <main className="landing-shell">
      <NoticeToast notice={notice} tone={tone} />

      <section className="landing-header-card">
        <div>
          <p className="brand-kicker">Trading Journal</p>
          <h1 className="landing-brand font-[var(--font-body)]">Sign in to your broker-scoped trading workspace.</h1>
        </div>

        <nav className="landing-menu" aria-label="Auth menu">
          <Link href="/" className="landing-menu-link">Home</Link>
          <Link href={`/signup?next=${encodeURIComponent(nextPath)}`} className="landing-menu-link">Create Account</Link>
        </nav>
      </section>

      <section className="landing-hero-simple">
        <div className="landing-copy-stack">
          <p className="eyebrow">Account Access</p>
          <h2 className="landing-title font-[var(--font-body)]">Pick up where your journal left off.</h2>
          <p className="landing-copy">
            Sign in to recover your active broker context, theme preference, positions, holdings, and cash ledger workflow.
          </p>
        </div>

        <section className="panel-strong section-stack landing-summary-card">
          <div>
            <p className="eyebrow">Login</p>
            <h3 className="section-heading">Access your trading portal</h3>
          </div>

          <LoginForm nextPath={nextPath} />
        </section>
      </section>
    </main>
  );
}
