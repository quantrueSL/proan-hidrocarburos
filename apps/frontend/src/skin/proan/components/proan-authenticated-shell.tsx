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
  hydrocarburos: { enabled: boolean };
};

type ProanAuthenticatedShellProps = {
  children: ReactNode;
  currentUser: UserRead | null;
  features: ShellFeatures;
  session: FrontendSession;
};

type NavItem = {
  href: string;
  key: "hydrocarburos-m1" | "compras" | "gerencia" | "dashboard";
  label: string;
};

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
  if (features.hydrocarburos.enabled) {
    return "/hidrocarburos";
  }
  return "/";
}

export function ProanAuthenticatedShell({
  children,
  currentUser,
  features,
  session
}: ProanAuthenticatedShellProps) {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isDictionaryOpen, setIsDictionaryOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setIsNavOpen(false);
    setIsDictionaryOpen(false);
  }, [pathname]);

  const homeHref = getHomeHref(features);
  const navItems: NavItem[] = features.hydrocarburos.enabled
    ? [
        { href: "/hidrocarburos", key: "hydrocarburos-m1", label: "M1 · Clasificación" },
        { href: "/compras", key: "compras", label: "M2 · Compras" },
        { href: "/aprobacion", key: "gerencia", label: "M3 · Aprobación" },
        { href: "/dashboard", key: "dashboard", label: "Dashboard" }
      ]
    : [];

  function isActive(item: NavItem) {
    return pathname === item.href || pathname?.startsWith(`${item.href}/`);
  }

  return (
    <>
      <div className="proan-shell">
        <header className="app-topbar proan-topbar">
          <button
            aria-expanded={isNavOpen}
            aria-label="Abrir navegacion"
            className={`topbar-menu-toggle${isNavOpen ? " is-open" : ""}`}
            onClick={() => setIsNavOpen((current) => !current)}
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

          <nav className={`topbar-nav proan-topbar-actions${isNavOpen ? " is-open" : ""}`}>
            {navItems.map((item) => (
              <Link
                aria-current={isActive(item) ? "page" : undefined}
                className={`topbar-nav-action topbar-nav-link${isActive(item) ? " is-active" : ""}`}
                href={item.href}
                key={item.key}
                onClick={() => setIsNavOpen(false)}
              >
                {item.label}
              </Link>
            ))}

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
