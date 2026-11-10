import { Link, NavLink, useLocation } from "react-router-dom";
import clsx from "clsx";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { shortAddress } from "../lib/format.js";
import {
  navSurfaceOpacity,
  navSurfaceTriggerId,
} from "../lib/navSurface.js";
import {
  ensureWagmiConnectorCompatibility,
  openWalletModal,
  reownEnabled,
  setWalletModalThemeMode,
} from "../lib/wagmi.js";
import { applyThemeWithRadialTransition } from "../lib/themeTransition.js";
import navLogo from "../logo/nav-logo.png";

const NAV_ITEMS = [
  {
    id: "trade",
    label: "BUY KPEG",
    mobileLabel: "BUY",
    to: "/trade",
    icon: "nf nf-cod-arrow_swap",
  },
  {
    id: "explore",
    label: "EXPLORE",
    mobileLabel: "EXPLORE",
    to: "/explore",
    icon: "nf nf-md-view_grid",
  },
  {
    id: "market",
    label: "MARKET",
    mobileLabel: "MARKET",
    to: "/market",
    icon: "nf nf-cod-tag",
  },
  {
    id: "collections",
    label: "MY COLLECTIONS",
    mobileLabel: "COLLECTION",
    to: "/collections",
    icon: "nf nf-fa-heart_o",
  },
] as const;

export function NavBar() {
  const location = useLocation();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const navRef = useRef<HTMLElement | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const [themeTransitioning, setThemeTransitioning] = useState(false);
  const [surfaceOpacity, setSurfaceOpacity] = useState(0);

  const onToggleTheme = (event: MouseEvent<HTMLButtonElement>) => {
    if (themeTransitioning) {
      return;
    }
    const next = theme === "dark" ? "light" : "dark";
    const buttonRect = event.currentTarget.getBoundingClientRect();
    const originX = buttonRect.left + buttonRect.width / 2;
    const originY = buttonRect.top + buttonRect.height / 2;
    setThemeTransitioning(true);
    void applyThemeWithRadialTransition({
      fromTheme: theme,
      toTheme: next,
      originX,
      originY,
      applyTheme: () => {
        flushSync(() => {
          setTheme(next);
        });
        document.documentElement.dataset.theme = next;
        localStorage.setItem("kpeg.theme", next);
        setWalletModalThemeMode(next);
      },
    }).finally(() => {
      setThemeTransitioning(false);
    });
  };

  const primaryConnector = connectors[0];
  const [hoveredNav, setHoveredNav] = useState<string | null>(null);

  useEffect(() => {
    let frameId = 0;
    let delayedFrameId = 0;
    const scheduleSurfaceUpdate = () => {
      if (typeof window === "undefined") {
        return;
      }
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        const navEl = navRef.current;
        const triggerId = navSurfaceTriggerId(location.pathname);
        const triggerEl =
          triggerId === null
            ? null
            : document.getElementById(triggerId);
        const next = navSurfaceOpacity({
          pathname: location.pathname,
          scrollY: window.scrollY,
          navBottom: navEl?.getBoundingClientRect().bottom ?? null,
          triggerTop: triggerEl?.getBoundingClientRect().top ?? null,
        });
        setSurfaceOpacity((current) =>
          Math.abs(current - next) < 0.01 ? current : next,
        );
      });
    };

    scheduleSurfaceUpdate();
    delayedFrameId = window.setTimeout(scheduleSurfaceUpdate, 90);
    window.addEventListener("scroll", scheduleSurfaceUpdate, { passive: true });
    window.addEventListener("resize", scheduleSurfaceUpdate);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      if (delayedFrameId) {
        window.clearTimeout(delayedFrameId);
      }
      window.removeEventListener("scroll", scheduleSurfaceUpdate);
      window.removeEventListener("resize", scheduleSurfaceUpdate);
    };
  }, [location.pathname]);

  const onWalletClick = () => {
    ensureWagmiConnectorCompatibility();
    if (isConnected) {
      if (reownEnabled) {
        void openWalletModal("Account");
        return;
      }
      disconnect();
      return;
    }

    if (reownEnabled) {
      void openWalletModal("Connect");
      return;
    }

    if (primaryConnector) {
      connect({ connector: primaryConnector });
    }
  };

  return (
    <>
      <nav
        ref={navRef}
        className="relative isolate sticky top-0 z-40 w-screen max-w-none py-[0.85rem] px-[var(--page-pad)] -mx-[calc((100vw-100%)/2)] max-[640px]:py-[0.62rem] max-sm:px-[var(--page-pad-mob)]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_42%,transparent)] backdrop-blur-[16px] transition-opacity duration-[180ms] ease-linear will-change-[opacity]"
          style={{ opacity: surfaceOpacity }}
        />
        <div className="relative mx-auto grid w-full max-w-[var(--page-max)] grid-cols-[1fr_auto_1fr] items-center gap-4 max-[979px]:grid-cols-[auto_1fr_auto]">
          <Link
            className="inline-flex w-fit items-center gap-[0.65rem] max-[640px]:gap-[0.46rem]"
            to="/"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-[#e6dfd3] shadow-[0_0_0_1px_var(--line)]">
              <img
                className="h-full w-full object-cover"
                src={navLogo}
                alt="kPEG logo"
              />
            </span>
            <span className="text-base font-extrabold tracking-[-0.03em] max-[640px]:text-[0.9rem]">
              kPEG
            </span>
          </Link>
          <div className="inline-flex items-center gap-[1.15rem] justify-self-center max-[979px]:hidden">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.id}
                className={({ isActive }) =>
                  clsx(
                    "relative text-[0.85rem] font-bold tracking-[-0.02em] transition-colors after:absolute after:right-0 after:left-0 after:-bottom-[0.55rem] after:h-px after:bg-current after:opacity-0",
                    { "after:opacity-100": isActive || hoveredNav === item.id },
                  )
                }
                style={({ isActive }) => ({
                  color:
                    isActive || hoveredNav === item.id
                      ? "var(--fg)"
                      : "var(--fg-muted)",
                })}
                onPointerEnter={() => setHoveredNav(item.id)}
                onPointerLeave={() =>
                  setHoveredNav((current) =>
                    current === item.id ? null : current,
                  )
                }
                onFocus={() => setHoveredNav(item.id)}
                onBlur={() =>
                  setHoveredNav((current) =>
                    current === item.id ? null : current,
                  )
                }
                end
                to={item.to}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
          <div className="inline-flex items-center justify-self-end gap-3 max-[979px]:col-start-3 max-[640px]:gap-2">
            <button
              className="inline-grid h-[1.85rem] w-[1.85rem] cursor-pointer place-items-center rounded-[5px] border border-[var(--line)] bg-transparent p-0 text-[var(--fg)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-45 max-[640px]:h-[1.62rem] max-[640px]:w-[1.62rem] max-[640px]:text-[0.8rem]"
              onClick={onToggleTheme}
              type="button"
              aria-label="toggle theme"
              disabled={themeTransitioning}
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
            {isConnected && address ? (
              <button
                className="min-h-[1.85rem] cursor-pointer rounded-[5px] border border-[var(--line)] bg-[var(--fg)] px-[0.58rem] text-[0.76rem] leading-none text-[var(--bg)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 max-[640px]:min-h-[1.62rem] max-[640px]:px-[0.44rem] max-[640px]:text-[0.66rem]"
                type="button"
                onClick={onWalletClick}
              >
                {shortAddress(address)}
              </button>
            ) : (
              <button
                className="min-h-[1.85rem] cursor-pointer rounded-[5px] border border-[var(--line)] bg-[var(--fg)] px-[0.58rem] text-[0.76rem] leading-none text-[var(--bg)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 max-[640px]:min-h-[1.85rem] max-[640px]:px-[0.44rem] max-[640px]:text-[0.7rem]"
                type="button"
                onClick={onWalletClick}
                disabled={!reownEnabled && (!primaryConnector || isPending)}
              >
                {isPending ? "CONNECTING..." : "CONNECT WALLET"}
              </button>
            )}
          </div>
        </div>
      </nav>
      <nav className="fixed right-0 bottom-0 left-0 z-30 hidden border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_68%,transparent)] px-[var(--page-pad)] pt-[0.75rem] pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-[16px] max-[979px]:grid max-sm:px-[var(--page-pad-mob)]">
        <div className="mx-auto grid w-full max-w-[34rem] grid-cols-4 items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.id}
              className={({ isActive }) =>
                clsx(
                  "grid justify-items-center gap-[0.35rem] text-[0.64rem] font-extrabold tracking-[0.03em] transition-opacity hover:opacity-100 max-[640px]:text-[0.56rem]",
                  { "opacity-75": !isActive },
                )
              }
              style={({ isActive }) => ({
                color: isActive ? "var(--fg)" : "var(--fg-muted)",
              })}
              end
              to={item.to}
            >
              <i
                className={`${item.icon} text-[1.25rem] leading-none text-current max-[640px]:text-[1rem]`}
                aria-hidden="true"
              />
              <span>{item.mobileLabel}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
