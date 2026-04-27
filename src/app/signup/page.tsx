import Link from "next/link";
import { redirect } from "next/navigation";
import { NoticeToast } from "@/src/app/components/notice-toast";
import { getCurrentUser, safeRedirectPath } from "@/src/lib/auth";
import { SignupForm } from "./signup-form";

type PageProps = {
  searchParams: Promise<{ notice?: string; tone?: string; next?: string }>;
};

export default async function SignupPage({ searchParams }: PageProps) {
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
          <h1 className="landing-brand font-[var(--font-body)]">Create your user account and claim your trading workspace.</h1>
        </div>

        <nav className="landing-menu" aria-label="Auth menu">
          <Link href="/" className="landing-menu-link">Home</Link>
          <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="landing-menu-link">Sign In</Link>
        </nav>
      </section>

      <section className="landing-hero-simple">
        <div className="landing-copy-stack">
          <p className="eyebrow">Signup</p>
          <h2 className="landing-title font-[var(--font-body)]">Start with your own broker-aware journal.</h2>
          <p className="landing-copy">
            Your account will own broker accounts, positions, holdings, and cash records. After signup, you will land in onboarding to create your first broker account before entering the portal.
          </p>
        </div>

        <section className="panel-strong section-stack landing-summary-card">
          <div>
            <p className="eyebrow">New Account</p>
            <h3 className="section-heading">Create your login</h3>
          </div>

          <SignupForm nextPath={nextPath} />
        </section>
      </section>
    </main>
  );
}
