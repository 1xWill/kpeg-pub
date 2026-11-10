import { afterEach, describe, expect, it } from "vitest";
import {
  assertReplayResetAllowed,
  requiresReplayResetConfirmation,
  resolveReplayAddresses
} from "../src/reconcile-onchain.js";

const originalEnv = { ...process.env };

describe("reconcile:onchain safety and scope config", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("requires explicit confirmation for production-like DB targets", () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      KPEG_DB_MODE: "libsql",
      KPEG_RECONCILE_CONFIRM_RESET: "",
    };
    expect(requiresReplayResetConfirmation(process.env)).toBe(true);
    expect(() => assertReplayResetAllowed(process.env)).toThrow("KPEG_RECONCILE_CONFIRM_RESET=1");
  });

  it("allows replay reset when confirmation is present", () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      KPEG_DB_MODE: "libsql",
      KPEG_RECONCILE_CONFIRM_RESET: "1",
    };
    expect(() => assertReplayResetAllowed(process.env)).not.toThrow();
  });

  it("resolves market/breeding inclusion flags from env", () => {
    process.env = {
      ...originalEnv,
      KPEG_RECONCILE_INCLUDE_MARKET: "1",
      KPEG_RECONCILE_INCLUDE_BREEDING: "0",
    };
    const resolvedA = resolveReplayAddresses({
      marketAddress: "0x0000000000000000000000000000000000000001",
      breedingAddress: "0x0000000000000000000000000000000000000002",
    });
    expect(resolvedA).toEqual({
      includeMarket: true,
      includeBreeding: false,
      marketAddress: "0x0000000000000000000000000000000000000001",
    });

    process.env = {
      ...originalEnv,
      KPEG_RECONCILE_INCLUDE_MARKET: "0",
      KPEG_RECONCILE_INCLUDE_BREEDING: "1",
    };
    const resolvedB = resolveReplayAddresses({
      marketAddress: "0x0000000000000000000000000000000000000001",
      breedingAddress: "0x0000000000000000000000000000000000000002",
    });
    expect(resolvedB).toEqual({
      includeMarket: false,
      includeBreeding: true,
      breedingAddress: "0x0000000000000000000000000000000000000002",
    });
  });
});
