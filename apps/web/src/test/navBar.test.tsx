import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavBar } from "../components/NavBar.js";

vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi")>();
  return {
    ...actual,
    useAccount: () => ({ address: undefined, isConnected: false }),
    useConnect: () => ({ connect: vi.fn(), connectors: [], isPending: false }),
    useDisconnect: () => ({ disconnect: vi.fn() }),
  };
});

vi.mock("../lib/wagmi.js", () => ({
  ensureWagmiConnectorCompatibility: vi.fn(),
  openWalletModal: vi.fn(),
  reownEnabled: false,
  setWalletModalThemeMode: vi.fn(),
}));

vi.mock("../lib/navSurface.js", () => ({
  navSurfaceOpacity: vi.fn(() => 0),
  navSurfaceTriggerId: vi.fn(() => null),
}));

vi.mock("../lib/themeTransition.js", () => ({
  applyThemeWithRadialTransition: vi.fn(async ({ applyTheme }) => {
    applyTheme();
  }),
}));

vi.mock("../logo/nav-logo.png", () => ({ default: "/nav-logo.png" }));

afterEach(() => {
  document.documentElement.dataset.theme = "dark";
});

describe("NavBar", () => {
  it("shows BUY KPEG before EXPLORE and keeps the logo linked to home", () => {
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>,
    );

    const desktopNav = screen.getAllByRole("navigation")[0];
    if (!desktopNav) {
      throw new Error("desktop nav not rendered");
    }
    const desktopLinks = within(desktopNav).getAllByRole("link");
    expect(desktopLinks.length).toBeGreaterThanOrEqual(4);
    const [logoLink, buyLink, exploreLink, marketLink] = desktopLinks;
    if (!logoLink || !buyLink || !exploreLink || !marketLink) {
      throw new Error("desktop nav links did not render");
    }
    expect(logoLink.getAttribute("href")).toBe("/");
    expect(buyLink.getAttribute("href")).toBe("/trade");
    expect(exploreLink.getAttribute("href")).toBe("/explore");
    expect(marketLink.getAttribute("href")).toBe("/market");
  });
});
