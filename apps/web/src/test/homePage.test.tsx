import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HomePage } from "../pages/HomePage.js";

describe("HomePage", () => {
  it("renders both ENTER APP CTAs to /trade and the twitter link", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    const enterLinks = screen.getAllByRole("link", { name: /enter app/i });
    expect(enterLinks).toHaveLength(2);
    expect(enterLinks.every((link) => link.getAttribute("href") === "/trade")).toBe(
      true,
    );

    const social = screen.getByRole("link", { name: /@kpegapp/i });
    expect(social.getAttribute("href")).toBe("https://x.com/kPEGapp");
    expect(social.getAttribute("target")).toBe("_blank");

    expect(
      screen.getByText(/kittypeg v1 · a uniswap v4 hook collection on base/i),
    ).not.toBeNull();
    expect(
      screen.getAllByText((_, node) =>
        (node?.textContent ?? "").includes("KittyPEG · $kPEG"),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText((_, node) =>
        (node?.textContent ?? "").includes("KPEGs are what come after JPEGs"),
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Checklist/i)).not.toBeNull();
    expect(screen.getByText(/9,999 total supply/i)).not.toBeNull();
    expect(screen.getByText(/0 Buy\/Sell tax/i)).not.toBeNull();
    expect(
      screen
        .getByRole("link", { name: /verified contract source/i })
        .getAttribute("href"),
    ).toBe("https://basescan.org/address/0xF5521a68495D7213Fa2d2F28Ab223281bcb2927A#code");
    expect(
      screen.getByText(/© 2026 · kittyPEG · An on-chain kitty collection/i),
    ).not.toBeNull();
  });
});
