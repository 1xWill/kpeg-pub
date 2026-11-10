import { describe, expect, it } from "vitest";
import {
  isPrivateOrLoopbackRpcUrl,
  parseAppEnvArgs,
  resolveBackendRpcFallbackUrlsForApp,
  resolveFrontendRpcUrlForApp,
  resolveRpcUrlForApp
} from "../../../scripts/write-app-env.mjs";

describe("app env RPC resolution", () => {
  it("supports localhost in local-sqlite mode and rejects cloud modes for localhost", () => {
    expect(parseAppEnvArgs(["localhost", "local-sqlite"])).toEqual({
      networkName: "localhost",
      mode: "local-sqlite"
    });
    expect(() => parseAppEnvArgs(["localhost", "cloud-turso"])).toThrow(/only supports local-sqlite/i);
  });

  it("resolves localhost backend and frontend RPC URLs without default fallbacks", () => {
    const backendRpc = resolveRpcUrlForApp({
      networkName: "localhost",
      mode: "local-sqlite",
      processEnv: { KPEG_LOCAL_RPC_URL: "http://127.0.0.1:18545" },
      existingEnv: {}
    });
    const frontendRpc = resolveFrontendRpcUrlForApp({
      networkName: "localhost",
      mode: "local-sqlite",
      processEnv: { KPEG_LOCAL_RPC_URL: "http://127.0.0.1:18545" },
      existingEnv: {}
    });
    const fallbacks = resolveBackendRpcFallbackUrlsForApp(
      {
        networkName: "localhost",
        mode: "local-sqlite",
        processEnv: {},
        existingEnv: {}
      },
      backendRpc
    );
    expect(backendRpc).toBe("http://127.0.0.1:18545");
    expect(frontendRpc).toBe("http://127.0.0.1:18545");
    expect(fallbacks).toBe("");
  });

  it("prefers network-specific RPC over generic KPEG_CHAIN_RPC_URL", () => {
    const rpcUrl = resolveRpcUrlForApp({
      networkName: "base-sepolia",
      mode: "cloud-turso",
      processEnv: {},
      existingEnv: {
        KPEG_CHAIN_RPC_URL: "http://127.0.0.1:8545",
        BASE_SEPOLIA_RPC: "https://sepolia.example-rpc.test"
      }
    });
    expect(rpcUrl).toBe("https://sepolia.example-rpc.test");
  });

  it("rejects cloud app env when resolved RPC is localhost/private", () => {
    expect(() =>
      resolveRpcUrlForApp({
        networkName: "base-mainnet",
        mode: "cloud-turso",
        processEnv: {},
        existingEnv: {
          KPEG_CHAIN_RPC_URL: "http://127.0.0.1:8545"
        }
      })
    ).toThrow(/private\/loopback RPC URL/i);
  });

  it("allows localhost RPC for local app modes", () => {
    const rpcUrl = resolveRpcUrlForApp({
      networkName: "base-sepolia",
      mode: "local-sqlite",
      processEnv: {},
      existingEnv: {
        KPEG_CHAIN_RPC_URL: "http://127.0.0.1:8545"
      }
    });
    expect(rpcUrl).toBe("http://127.0.0.1:8545");
  });

  it("adds the network default backend RPC as a fallback for custom primary RPCs", () => {
    const fallbackUrls = resolveBackendRpcFallbackUrlsForApp(
      {
        networkName: "base-mainnet",
        mode: "cloud-turso",
        processEnv: {},
        existingEnv: {},
      },
      "https://custom-rpc.example",
    );
    expect(fallbackUrls).toBe("https://mainnet.base.org");
  });

  it("rejects private fallback RPCs for cloud app env", () => {
    expect(() =>
      resolveBackendRpcFallbackUrlsForApp(
        {
          networkName: "base-mainnet",
          mode: "cloud-turso",
          processEnv: {},
          existingEnv: {
            KPEG_CHAIN_RPC_FALLBACK_URLS: "http://127.0.0.1:8545",
          },
        },
        "https://custom-rpc.example",
      ),
    ).toThrow(/private\/loopback fallback RPC URL/i);
  });

  it("resolves frontend RPC independently from backend RPC", () => {
    const frontendRpc = resolveFrontendRpcUrlForApp({
      networkName: "base-sepolia",
      mode: "cloud-turso",
      processEnv: {},
      existingEnv: {
        BASE_SEPOLIA_RPC: "https://backend.unrestricted-rpc.test",
        BASE_SEPOLIA_RPC_PUBLIC: "https://frontend.whitelisted-rpc.test"
      }
    });
    expect(frontendRpc).toBe("https://frontend.whitelisted-rpc.test");
  });

  it("rejects cloud app env when resolved frontend RPC is localhost/private", () => {
    expect(() =>
      resolveFrontendRpcUrlForApp({
        networkName: "base-sepolia",
        mode: "cloud-turso",
        processEnv: {},
        existingEnv: {
          BASE_SEPOLIA_RPC_PUBLIC: "http://127.0.0.1:8545"
        }
      })
    ).toThrow(/private\/loopback frontend RPC URL/i);
  });

  it("detects private and public RPC hosts", () => {
    expect(isPrivateOrLoopbackRpcUrl("http://192.168.1.20:8545")).toBe(true);
    expect(isPrivateOrLoopbackRpcUrl("https://mainnet.base.org")).toBe(false);
  });
});
