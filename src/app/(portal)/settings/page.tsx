import { NoticeToast } from "@/src/app/components/notice-toast";
import { requireCurrentUser } from "@/src/lib/auth";
import { getWorkspacePreference } from "@/src/lib/workspace-preference";

type PageProps = {
  searchParams: Promise<{ notice?: string; tone?: string }>;
};

export default async function SettingsPage({ searchParams }: PageProps) {
  const { notice, tone } = await searchParams;
  const user = await requireCurrentUser("/settings");
  const workspace = await getWorkspacePreference();

  return (
    <main className="page-shell">
      <NoticeToast notice={notice} tone={tone} />

      <section className="hero-card">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Settings</p>
            <h2 className="page-title">Control the defaults behind your personal trading workspace.</h2>
            <p className="page-subtitle">
              Theme mode and active broker context now live in your user preference record, so each account can keep its own portal setup.
            </p>
          </div>
        </div>
      </section>

      <section className="panel-strong section-stack">
        <div>
          <h3 className="section-heading">Account</h3>
          <p className="section-copy">Update your display name and password for this trading workspace login.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <form method="POST" action="/api/account-settings" className="section-stack panel space-y-5">
            <input type="hidden" name="intent" value="update-profile" />

            <div>
              <h4 className="section-heading">Profile</h4>
              <p className="section-copy">Email stays fixed for now. You can update the display name used around the workspace.</p>
            </div>

            <label className="field-stack">
              <span className="field-label">Email</span>
              <input value={user.email} className="input-field" disabled readOnly />
            </label>

            <label className="field-stack">
              <span className="field-label">Display Name</span>
              <input
                name="displayName"
                defaultValue={user.displayName ?? ""}
                className="input-field"
                placeholder="Optional name"
                autoComplete="name"
              />
            </label>

            <div className="hero-actions mt-4">
              <button className="btn-primary">Save Profile</button>
            </div>
          </form>

          <form method="POST" action="/api/account-settings" className="section-stack panel space-y-5">
            <input type="hidden" name="intent" value="change-password" />

            <div>
              <h4 className="section-heading">Password</h4>
              <p className="section-copy">Change your password without leaving the portal.</p>
            </div>

            <label className="field-stack">
              <span className="field-label">Current Password</span>
              <input name="currentPassword" type="password" className="input-field" autoComplete="current-password" required />
            </label>

            <label className="field-stack">
              <span className="field-label">New Password</span>
              <input name="newPassword" type="password" className="input-field" autoComplete="new-password" placeholder="At least 8 characters" required />
            </label>

            <label className="field-stack">
              <span className="field-label">Confirm New Password</span>
              <input name="confirmPassword" type="password" className="input-field" autoComplete="new-password" required />
            </label>

            <div className="hero-actions mt-4">
              <button className="btn-primary">Update Password</button>
            </div>
          </form>
        </div>
      </section>

      <section className="panel-strong section-stack">
        <div>
          <h3 className="section-heading">Appearance</h3>
          <p className="section-copy">Choose the default theme for your user workspace.</p>
        </div>

        <div className="theme-toggle-grid">
          <form method="POST" action="/api/workspace-preferences">
            <input type="hidden" name="intent" value="set-theme" />
            <input type="hidden" name="themeMode" value="LIGHT" />
            <button className={workspace.themeMode === "LIGHT" ? "theme-choice theme-choice-active" : "theme-choice"}>
              <span className="theme-choice-label">Light Mode</span>
              <span className="theme-choice-copy">Warm paper surfaces with softer contrast for daytime reviewing and journaling.</span>
            </button>
          </form>

          <form method="POST" action="/api/workspace-preferences">
            <input type="hidden" name="intent" value="set-theme" />
            <input type="hidden" name="themeMode" value="DARK" />
            <button className={workspace.themeMode === "DARK" ? "theme-choice theme-choice-active" : "theme-choice"}>
              <span className="theme-choice-label">Dark Mode</span>
              <span className="theme-choice-copy">Low-glare panels for longer portal sessions and denser trading review screens.</span>
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}




