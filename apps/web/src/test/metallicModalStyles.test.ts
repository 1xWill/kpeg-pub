import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GLOBALS_CSS_PATH = resolve(import.meta.dirname, "../globals.css");

function readGlobalsCss(): string {
  return readFileSync(GLOBALS_CSS_PATH, "utf8");
}

function readTierMetalModalRule(): string {
  const css = readGlobalsCss();
  const match = css.match(
    /body\[data-tier-metal-modal-open="true"\]\s+\.tier-metal-card::after\s*\{([^}]*)\}/,
  );
  if (!match) {
    throw new Error("Missing modal metallic card rule in globals.css");
  }
  return match[1] ?? "";
}

function readTierMetalScrollingRule(): string {
  const css = readGlobalsCss();
  const match = css.match(
    /body\[data-tier-metal-scrolling="true"\]\s+\.tier-metal-card::after[^{]*\{([^}]*)\}/,
  );
  if (!match) {
    throw new Error("Missing metallic scrolling pause rule in globals.css");
  }
  return match[1] ?? "";
}

function readTierMetalResizingCardRule(): string {
  const css = readGlobalsCss();
  const match = css.match(
    /body\[data-tier-metal-resizing="true"\]\s+\.tier-metal-card::after\s*\{([^}]*)\}/,
  );
  if (!match) {
    throw new Error("Missing metallic resizing card pause rule in globals.css");
  }
  return match[1] ?? "";
}

function readTierMetalResizingTextRule(): string {
  const css = readGlobalsCss();
  const match = css.match(
    /body\[data-tier-metal-resizing="true"\]\s+\.tier-metal-value\s*\{([^}]*)\}/,
  );
  if (!match) {
    throw new Error("Missing metallic resizing text pause rule in globals.css");
  }
  return match[1] ?? "";
}

function readTierMetalSyncPhaseRule(): string {
  const css = readGlobalsCss();
  const match = css.match(
    /body\[data-tier-metal-sync-phase="b"\]\s+\.tier-metal-card::after\s*\{([^}]*)\}/,
  );
  if (!match) {
    throw new Error("Missing metallic sync phase rule in globals.css");
  }
  return match[1] ?? "";
}

describe("metallic modal styles", () => {
  it("pauses background metallic cards without resetting the animation timeline", () => {
    const rule = readTierMetalModalRule();
    expect(rule).toContain("animation-play-state: paused;");
    expect(rule).toContain("opacity: 0.34;");
    expect(rule).not.toMatch(/\banimation\s*:\s*(?!play-state)/);
    expect(rule).not.toMatch(/\bbackground-position\s*:/);
  });

  it("avoids hard animation resets that can cause shimmer flicker", () => {
    const css = readGlobalsCss();
    expect(css).not.toMatch(/\.tier-metal-card\.tier-metal-restart::after/);
    expect(css).not.toMatch(/\banimation\s*:\s*none\s*!important;/);
  });

  it("pauses metallic shimmer while scrolling before a global resume resync", () => {
    const rule = readTierMetalScrollingRule();
    expect(rule).toContain("animation-play-state: paused;");
    expect(rule).not.toContain("opacity:");
  });

  it("pauses metallic shimmer while resizing before deferred global resync", () => {
    const rule = readTierMetalResizingCardRule();
    expect(rule).toContain("animation-play-state: paused;");
    expect(rule).not.toContain("opacity:");
  });

  it("pauses metallic tier text shimmer while resizing", () => {
    const rule = readTierMetalResizingTextRule();
    expect(rule).toContain("animation-play-state: paused;");
  });

  it("supports global timeline restart by swapping animation-name", () => {
    const rule = readTierMetalSyncPhaseRule();
    expect(rule).toContain("animation-name: tier-metal-sheen-b;");
  });
});
