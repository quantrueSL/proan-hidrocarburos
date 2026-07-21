"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { ProfilePanel } from "@/components/profile-panel";
import type { FrontendSession } from "@/types/auth";
import type { UserRead } from "@/types/gateway";
import { proanBranding } from "@/skin/proan/branding";
import proanIcon from "@/skin/proan/assets/logos/iconoproan.png";

type ShellFeatures = {
  report: { enabled: boolean; assistant: { enabled: boolean } };
  alerts: { enabled: boolean };
};

type ProanAuthenticatedShellProps = {
  children: ReactNode;
  currentUser: UserRead | null;
  features: ShellFeatures;
  session: FrontendSession;
};

type NavItem = {
  href: string;
  key: "report" | "alerts";
  label: string;
};

function ReportIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path d="M7 4h7l5 5v11H7z" />
      <path d="M14 4v5h5" />
      <path d="M10 13h6M10 17h6M10 9h2" />
    </svg>
  );
}

function AlertsIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path d="M12 4a5 5 0 0 0-5 5v2.4c0 .7-.2 1.3-.6 1.9L5 15h14l-1.4-1.7c-.4-.5-.6-1.2-.6-1.9V9a5 5 0 0 0-5-5Z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path d="M3 5h6a4 4 0 0 1 4 4v10a3 3 0 0 0-3-3H3Z" />
      <path d="M21 5h-6a4 4 0 0 0-4 4v10a3 3 0 0 1 3-3h7Z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19a7 7 0 0 1 14 0" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path d="M10 4H5v16h5" />
      <path d="M13 8l5 4-5 4" />
      <path d="M8 12h10" />
    </svg>
  );
}

function getHomeHref(features: ShellFeatures): string {
  if (features.report.enabled) {
    return "/report";
  }

  return "/alerts";
}

export function ProanAuthenticatedShell({
  children,
  currentUser,
  features,
  session
}: ProanAuthenticatedShellProps) {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDictionaryOpen, setIsDictionaryOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setIsSidebarOpen(false);
    setIsDictionaryOpen(false);
  }, [pathname]);

  const homeHref = getHomeHref(features);
  const navItems = ([
    features.report.enabled
      ? { href: "/report", key: "report", label: proanBranding.nav.report }
      : null,
    features.alerts.enabled
      ? { href: "/alerts", key: "alerts", label: proanBranding.nav.alerts }
      : null
  ] as Array<NavItem | null>).filter((item): item is NavItem => item !== null);

  function isActive(href: string) {
    return pathname === href || pathname?.startsWith(`${href}/`);
  }

  return (
    <>
      <div className="proan-shell">
        {isSidebarOpen ? (
          <button
            aria-label="Cerrar menu lateral"
            className="proan-shell-backdrop"
            onClick={() => setIsSidebarOpen(false)}
            type="button"
          />
        ) : null}

        <header className="app-topbar proan-topbar">
          <button
            aria-expanded={isSidebarOpen}
            aria-label="Abrir navegacion"
            className={`topbar-menu-toggle${isSidebarOpen ? " is-open" : ""}`}
            onClick={() => setIsSidebarOpen((current) => !current)}
            type="button"
          >
            <span />
            <span />
            <span />
          </button>

          <Link aria-label={proanBranding.productName} className="topbar-brand" href={homeHref}>
            <Image
              alt={proanBranding.productName}
              className="topbar-brand-icon"
              priority
              src={proanIcon}
            />
            <span className="proan-topbar-brand-copy">
              <span className="topbar-brand-name">{proanBranding.productName}</span>
            </span>
          </Link>

          <nav className={`topbar-nav proan-topbar-actions${isSidebarOpen ? " is-open" : ""}`}>
            <div className="topbar-dictionary">
              <button
                aria-expanded={isDictionaryOpen}
                aria-haspopup="menu"
                aria-label="Diccionario"
                className="topbar-nav-action topbar-nav-action-icon"
                onClick={() => setIsDictionaryOpen((current) => !current)}
                type="button"
              >
                <span aria-hidden="true" className="topbar-nav-icon">
                  <BookIcon />
                </span>
              </button>

              {isDictionaryOpen ? (
                <div className="topbar-dictionary-panel" role="menu">
                  <button
                    aria-pressed="true"
                    className="topbar-dictionary-option is-selected"
                    role="menuitemradio"
                    type="button"
                  >
                    <span>Espanol</span>
                    <span className="topbar-dictionary-check">✓</span>
                  </button>
                </div>
              ) : null}
            </div>

            <button
              aria-label="Mi perfil"
              className="topbar-nav-action topbar-nav-action-icon"
              onClick={() => {
                setIsDictionaryOpen(false);
                setIsProfileOpen(true);
              }}
              type="button"
            >
              <span aria-hidden="true" className="topbar-nav-icon">
                <UserIcon />
              </span>
            </button>

            <LogoutButton className="topbar-nav-action topbar-nav-action-icon">
              <span aria-hidden="true" className="topbar-nav-icon">
                <LogoutIcon />
              </span>
            </LogoutButton>
          </nav>
        </header>

        <aside className={`proan-sidebar${isSidebarOpen ? " is-open" : ""}`}>
          <nav className="proan-sidebar-nav">
            {navItems.map((item) => (
              <Link
                aria-label={item.label}
                className={`proan-sidebar-link${isActive(item.href) ? " is-active" : ""}`}
                href={item.href}
                key={item.key}
                onClick={() => setIsSidebarOpen(false)}
              >
                <span aria-hidden="true" className="proan-sidebar-link-icon">
                  {item.key === "report" ? <ReportIcon /> : null}
                  {item.key === "alerts" ? <AlertsIcon /> : null}
                </span>
                <span className="proan-sidebar-link-label">{item.label}</span>
              </Link>
            ))}
          </nav>
        </aside>

        <div className="proan-shell-content">
          <div className="proan-content-scroll">
            <div className="main-panel proan-main-panel">{children}</div>
          </div>
        </div>
      </div>

      <ProfilePanel
        apps={session.apps}
        email={session.email}
        initialUser={currentUser}
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
      />
    </>
  );
}
