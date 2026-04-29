"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLinkItem = {
  href: string;
  label: string;
};

type NavSection = {
  title: string;
  items: NavLinkItem[];
};

const navSections: NavSection[] = [
  {
    title: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard" }],
  },
  {
    title: "Trading",
    items: [
      { href: "/positions", label: "Positions" },
      { href: "/holdings", label: "Holdings" },
      { href: "/cash-ledger", label: "Cash Ledger" },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/imports", label: "Imports" },
      { href: "/broker-accounts", label: "Broker Accounts" },
    ],
  },
  {
    title: "Reports",
    items: [{ href: "/reports", label: "Management Reports" }],
  },
  {
    title: "Administration",
    items: [{ href: "/settings", label: "Settings" }],
  },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalNav({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();

  return (
    <nav className="portal-nav" aria-label="Primary portal menu">
      {navSections.map((section) => (
        <section key={section.title} className="portal-nav-section">
          <p className="portal-nav-heading">{section.title}</p>
          <div className="portal-nav-list">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={active ? "portal-nav-item portal-nav-item-active" : "portal-nav-item"}
                >
                  <span>{item.label}</span>
                  <span className="portal-nav-arrow">›</span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      <section className="portal-nav-section">
        <p className="portal-nav-heading">Account</p>
        <div className="portal-nav-list">
          <div className="portal-nav-item portal-nav-item-muted" aria-disabled="true">
            <span>{userEmail}</span>
          </div>
          <form method="POST" action="/api/auth/logout">
            <button type="submit" className="portal-nav-item w-full cursor-pointer text-left">
              <span>Sign Out</span>
              <span className="portal-nav-arrow">›</span>
            </button>
          </form>
        </div>
      </section>
    </nav>
  );
}
