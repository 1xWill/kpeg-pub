import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyThemeWithRadialTransition,
  themeTransitionAnimation,
  themeTransitionRadius,
} from "../lib/themeTransition.js";

type DocumentWithViewTransition = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransition;
};

function setReducedMotionPreference(enabled: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        enabled && query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

const originalMatchMedia = window.matchMedia;
const originalAnimate = document.documentElement.animate;
const originalStartViewTransition = (document as DocumentWithViewTransition)
  .startViewTransition;

describe("theme transition helpers", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.themeTransitioning;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    Object.defineProperty(document.documentElement, "animate", {
      configurable: true,
      writable: true,
      value: originalAnimate,
    });
    const doc = document as DocumentWithViewTransition;
    if (originalStartViewTransition) {
      doc.startViewTransition = originalStartViewTransition;
    } else {
      Reflect.deleteProperty(
        doc as unknown as Record<string, unknown>,
        "startViewTransition",
      );
    }
    delete document.documentElement.dataset.themeTransitioning;
  });

  it("computes radius to cover the full viewport from the click origin", () => {
    expect(themeTransitionRadius(60, 40, 120, 80)).toBeCloseTo(
      Math.hypot(60, 40),
      8,
    );
  });

  it("uses new-root reveal for dark to light and old-root shrink for light to dark", () => {
    const reveal = themeTransitionAnimation("dark", "light", 15, 25, 100);
    expect(reveal.pseudoElement).toBe("::view-transition-new(root)");
    expect(reveal.clipPath).toEqual([
      "circle(0px at 15px 25px)",
      "circle(100px at 15px 25px)",
    ]);

    const shrink = themeTransitionAnimation("light", "dark", 15, 25, 100);
    expect(shrink.pseudoElement).toBe("::view-transition-old(root)");
    expect(shrink.clipPath).toEqual([
      "circle(100px at 15px 25px)",
      "circle(0px at 15px 25px)",
    ]);
  });

  it("falls back to immediate theme apply when reduced motion is enabled", async () => {
    setReducedMotionPreference(true);
    const startViewTransition = vi.fn();
    (document as DocumentWithViewTransition).startViewTransition = startViewTransition;
    const applyTheme = vi.fn();

    await applyThemeWithRadialTransition({
      fromTheme: "dark",
      toTheme: "light",
      originX: 25,
      originY: 25,
      applyTheme,
    });

    expect(applyTheme).toHaveBeenCalledTimes(1);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("runs radial animation when view transitions are supported", async () => {
    setReducedMotionPreference(false);
    const applyTheme = vi.fn();
    const animate = vi
      .fn()
      .mockReturnValue({ finished: Promise.resolve() } as unknown as Animation);
    Object.defineProperty(document.documentElement, "animate", {
      configurable: true,
      writable: true,
      value: animate,
    });
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
      void update();
      return {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        skipTransition: vi.fn(),
        types: new Set<string>(),
      } as ViewTransition;
    });
    (document as DocumentWithViewTransition).startViewTransition = startViewTransition;

    await applyThemeWithRadialTransition({
      fromTheme: "dark",
      toTheme: "light",
      originX: 10,
      originY: 10,
      applyTheme,
      durationMs: 400,
    });

    expect(applyTheme).toHaveBeenCalledTimes(1);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]?.[1]).toMatchObject({
      duration: 400,
      pseudoElement: "::view-transition-new(root)",
    });
    expect(document.documentElement.dataset.themeTransitioning).toBeUndefined();
    expect(document.documentElement.dataset.themeTransitionDirection).toBeUndefined();
  });

  it("uses old-root radial shrink for light to dark transitions", async () => {
    setReducedMotionPreference(false);
    const applyTheme = vi.fn();
    const animate = vi
      .fn()
      .mockReturnValue({ finished: Promise.resolve() } as unknown as Animation);
    Object.defineProperty(document.documentElement, "animate", {
      configurable: true,
      writable: true,
      value: animate,
    });
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
      void update();
      return {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        skipTransition: vi.fn(),
        types: new Set<string>(),
      } as ViewTransition;
    });
    (document as DocumentWithViewTransition).startViewTransition = startViewTransition;

    await applyThemeWithRadialTransition({
      fromTheme: "light",
      toTheme: "dark",
      originX: 10,
      originY: 10,
      applyTheme,
      durationMs: 400,
    });

    expect(applyTheme).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]?.[1]).toMatchObject({
      duration: 400,
      pseudoElement: "::view-transition-old(root)",
    });
    expect(document.documentElement.dataset.themeTransitioning).toBeUndefined();
    expect(document.documentElement.dataset.themeTransitionDirection).toBeUndefined();
  });
});
