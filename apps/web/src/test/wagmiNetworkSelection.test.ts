import { describe, expect, it } from "vitest";
import { isLocalAppOrigin, resolveWalletChains } from "../lib/wagmi.js";

describe("wallet chain selection", () => {
  it("keeps localhost only for local origins", () => {
    expect(isLocalAppOrigin("http://localhost:5173")).toBe(true);
    expect(isLocalAppOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isLocalAppOrigin("https://kpeg.app")).toBe(false);
  });

  it("advertises only Base mainnet on public origins", () => {
    expect(resolveWalletChains("https://kpeg.app").map((chain) => chain.id)).toEqual([8453]);
  });

  it("keeps localhost, Base Sepolia, and Base mainnet available for local dev origins", () => {
    expect(resolveWalletChains("http://localhost:5173").map((chain) => chain.id)).toEqual([1337, 84532, 8453]);
  });
});
