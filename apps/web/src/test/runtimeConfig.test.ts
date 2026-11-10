import { describe, expect, it } from "vitest";
import {
  resolveRuntimeAddress,
  resolveRuntimeChainId,
} from "../lib/runtimeConfig.js";

describe("runtime config helpers", () => {
  it("prefers API runtime addresses over build-time env addresses", () => {
    expect(
      resolveRuntimeAddress(
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222",
      ),
    ).toBe("0x1111111111111111111111111111111111111111");
  });

  it("falls back to env addresses while config is unavailable", () => {
    expect(
      resolveRuntimeAddress(null, "0x2222222222222222222222222222222222222222"),
    ).toBe("0x2222222222222222222222222222222222222222");
  });

  it("prefers runtime chain id and keeps Base Sepolia as final fallback", () => {
    expect(resolveRuntimeChainId(8453, "84532")).toBe(8453);
    expect(resolveRuntimeChainId(null, "31337")).toBe(31337);
    expect(resolveRuntimeChainId(null, undefined)).toBe(84532);
  });
});
