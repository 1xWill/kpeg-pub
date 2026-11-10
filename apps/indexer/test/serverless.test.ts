import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("serverless api wrapper", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("returns structured JSON when runtime boot fails", async () => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      KPEG_DB_MODE: "libsql",
      KPEG_LIBSQL_URL: "libsql://example.turso.io",
      KPEG_LIBSQL_AUTH_TOKEN: "token",
      KPEG_CHAIN_ID: "not-a-number",
      KPEG_CHAIN_RPC_URL: "https://rpc.example",
      KPEG_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000001",
      KPEG_MARKET_ADDRESS: "0x0000000000000000000000000000000000000002",
      KPEG_ROUTER_ADDRESS: "0x0000000000000000000000000000000000000003",
      KPEG_QUOTER_ADDRESS: "0x0000000000000000000000000000000000000004",
    };
    const { handleApiRequest } = await import("../src/serverless.js");

    const response = await handleApiRequest({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(response.body)).toMatchObject({
      ok: false,
      error: "api unavailable",
    });
  });
});
