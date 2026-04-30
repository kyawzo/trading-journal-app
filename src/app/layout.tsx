import { getWorkspacePreference, themeModeToAttribute } from "@/src/lib/workspace-preference";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const bodyFont = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
});

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const workspace = await getWorkspacePreference();

  return (
    <html lang="en" data-theme={themeModeToAttribute(workspace.themeMode)}>
      <body suppressHydrationWarning className={`${bodyFont.variable} app-shell font-[var(--font-body)]`}>
        {children}
      </body>
    </html>
  );
}
