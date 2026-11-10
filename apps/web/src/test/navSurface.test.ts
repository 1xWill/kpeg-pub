import { describe, expect, it } from "vitest";
import {
  navSurfaceOpacity,
  navSurfaceAlwaysTransparent,
  navSurfaceTriggerId,
  shouldUseSolidNavSurface,
} from "../lib/navSurface.js";

describe("nav surface routing", () => {
  it("maps trigger ids for scroll-threshold routes", () => {
    expect(navSurfaceTriggerId("/explore")).toBe("nav-surface-trigger-gallery");
    expect(navSurfaceTriggerId("/market")).toBe(
      "nav-surface-trigger-kitty-bazaar",
    );
    expect(navSurfaceTriggerId("/collections")).toBe(
      "nav-surface-trigger-kitty-nest",
    );
    expect(navSurfaceTriggerId("/portfolio/0xabc")).toBe(
      "nav-surface-trigger-portfolio",
    );
  });

  it("keeps trade route transparent", () => {
    expect(navSurfaceAlwaysTransparent("/trade")).toBe(true);
    expect(
      shouldUseSolidNavSurface({
        pathname: "/trade",
        scrollY: 999,
        navBottom: 60,
        triggerTop: 0,
      }),
    ).toBe(false);
  });

  it("stays transparent at top of page", () => {
    expect(
      shouldUseSolidNavSurface({
        pathname: "/market",
        scrollY: 0,
        navBottom: 60,
        triggerTop: 40,
      }),
    ).toBe(false);
  });

  it("turns solid when nav reaches section heading", () => {
    expect(
      shouldUseSolidNavSurface({
        pathname: "/market",
        scrollY: 100,
        navBottom: 64,
        triggerTop: 120,
      }),
    ).toBe(false);
    expect(
      shouldUseSolidNavSurface({
        pathname: "/market",
        scrollY: 100,
        navBottom: 64,
        triggerTop: 64,
      }),
    ).toBe(true);
  });

  it("keeps trigger-routes transparent until trigger heading is measurable", () => {
    expect(
      shouldUseSolidNavSurface({
        pathname: "/collections",
        scrollY: 150,
        navBottom: 64,
        triggerTop: null,
      }),
    ).toBe(false);
  });

  it("fades nav surface progressively near the trigger threshold", () => {
    expect(
      navSurfaceOpacity({
        pathname: "/market",
        scrollY: 120,
        navBottom: 64,
        triggerTop: 124,
      }),
    ).toBeCloseTo(0, 3);
    expect(
      navSurfaceOpacity({
        pathname: "/market",
        scrollY: 120,
        navBottom: 64,
        triggerTop: 90,
      }),
    ).toBeGreaterThan(0.45);
    expect(
      navSurfaceOpacity({
        pathname: "/market",
        scrollY: 120,
        navBottom: 64,
        triggerTop: 64,
      }),
    ).toBe(1);
  });
});
