import { base, baseSepolia, localhost } from "viem/chains";
import type { Chain } from "viem";
import { createConfig, http, type Config } from "wagmi";
import { reconnect } from "wagmi/actions";
import { injected } from "wagmi/connectors";
import type { AppKitNetwork } from "@reown/appkit/networks";

const rpcUrlLocal = import.meta.env.VITE_KPEG_RPC_URL_LOCAL ?? "http://127.0.0.1:8545";
const rpcUrlBaseMainnet = import.meta.env.VITE_KPEG_RPC_URL_BASE_MAINNET ?? "https://mainnet.base.org";
const rpcUrlBaseSepolia = import.meta.env.VITE_KPEG_RPC_URL_BASE_SEPOLIA ?? "https://sepolia.base.org";
const reownProjectId = import.meta.env.VITE_REOWN_PROJECT_ID?.trim() ?? "";
const appOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";
type WalletThemeMode = "dark" | "light";
type WalletModal = {
  open: (options?: { view?: "Account" | "Connect" }) => unknown;
  setThemeMode: (themeMode: WalletThemeMode) => void;
};
type WagmiConfigListener = (config: Config) => void;

type ReownAdapterModule = typeof import("@reown/appkit-adapter-wagmi");
type ReownNetworksModule = typeof import("@reown/appkit/networks");
type ReownReactModule = typeof import("@reown/appkit/react");
type ReownNetworkList = [AppKitNetwork, ...AppKitNetwork[]];

let walletThemeMode: WalletThemeMode =
  typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";
let walletModal: WalletModal | undefined;
let reownSetupPromise: Promise<WalletModal | undefined> | null = null;
const wagmiConfigListeners = new Set<WagmiConfigListener>();

export function isLocalAppOrigin(origin = appOrigin): boolean {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

const localChains = [localhost, baseSepolia, base] as const;
const publicChains = [base] as const;

export function resolveWalletChains(
  origin = appOrigin,
): typeof localChains | typeof publicChains {
  return isLocalAppOrigin(origin) ? localChains : publicChains;
}

const chains: readonly [Chain, ...Chain[]] = isLocalAppOrigin(appOrigin) ? localChains : publicChains;
const appIcon =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#f7ecda"/><path d="M16 36c0-9 7-16 16-16s16 7 16 16v8H16z" fill="#8a5a44"/><circle cx="24" cy="30" r="3" fill="#111"/><circle cx="40" cy="30" r="3" fill="#111"/><path d="M26 40c3 3 9 3 12 0" stroke="#111" stroke-width="3" stroke-linecap="round" fill="none"/></svg>'
  );
const transports = isLocalAppOrigin(appOrigin)
  ? ({
      [localhost.id]: http(rpcUrlLocal),
      [baseSepolia.id]: http(rpcUrlBaseSepolia),
      [base.id]: http(rpcUrlBaseMainnet)
    } as const)
  : ({
      [base.id]: http(rpcUrlBaseMainnet)
    } as const);

export const reownEnabled = reownProjectId.length > 0;
const fallbackWagmiConfig = createConfig({
  chains,
  connectors: [injected()],
  transports
});
let currentWagmiConfig: Config = fallbackWagmiConfig;

function setCurrentWagmiConfig(nextConfig: Config): void {
  if (currentWagmiConfig === nextConfig) {
    return;
  }
  currentWagmiConfig = nextConfig;
  ensureWagmiConnectorCompatibility(nextConfig);
  for (const listener of wagmiConfigListeners) {
    listener(nextConfig);
  }
}

export function getWagmiConfig(): Config {
  return currentWagmiConfig;
}

export function subscribeWagmiConfig(listener: WagmiConfigListener): () => void {
  wagmiConfigListeners.add(listener);
  return () => {
    wagmiConfigListeners.delete(listener);
  };
}

async function setupReownWalletRuntime() {
  if (!reownEnabled) return undefined;
  if (walletModal) return walletModal;
  reownSetupPromise ??= (async () => {
    const [{ WagmiAdapter }, reownNetworks, { createAppKit }] = await Promise.all([
      import("@reown/appkit-adapter-wagmi") as Promise<ReownAdapterModule>,
      import("@reown/appkit/networks") as Promise<ReownNetworksModule>,
      import("@reown/appkit/react") as Promise<ReownReactModule>
    ]);
    const networks: ReownNetworkList = isLocalAppOrigin(appOrigin)
      ? [reownNetworks.localhost, reownNetworks.baseSepolia, reownNetworks.base]
      : [reownNetworks.base];
    const wagmiAdapter = new WagmiAdapter({
      networks,
      projectId: reownProjectId,
      transports
    });
    setCurrentWagmiConfig(wagmiAdapter.wagmiConfig);
    await reconnect(wagmiAdapter.wagmiConfig).catch(() => undefined);
    walletModal = createAppKit({
      adapters: [wagmiAdapter] as NonNullable<Parameters<typeof createAppKit>[0]["adapters"]>,
      metadata: {
        name: "kPEG",
        description: "kPEG onchain kitties",
        url: appOrigin,
        icons: [appIcon]
      },
      networks,
      projectId: reownProjectId,
      themeMode: walletThemeMode
    });
    return walletModal;
  })().finally(() => {
    reownSetupPromise = null;
  });
  return reownSetupPromise;
}

export async function openWalletModal(view: "Account" | "Connect") {
  const modal = await setupReownWalletRuntime();
  await modal?.open({ view });
}

export async function ensureWalletRuntimeLoaded() {
  await setupReownWalletRuntime();
}

export function setWalletModalThemeMode(themeMode: WalletThemeMode) {
  walletThemeMode = themeMode;
  walletModal?.setThemeMode(themeMode);
}

type ChainCapableConnector = {
  id?: string;
  uid?: string;
  getProvider?: ((input?: { chainId?: number | undefined }) => Promise<unknown>) | undefined;
  getChainId?: (() => Promise<number>) | undefined;
};

function parseChainId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  if (/^0x[0-9a-f]+$/i.test(value)) {
    const parsedHex = Number.parseInt(value, 16);
    return Number.isFinite(parsedHex) ? parsedHex : null;
  }
  const parsedDecimal = Number(value);
  return Number.isFinite(parsedDecimal) ? parsedDecimal : null;
}

function patchConnectorGetChainId(connector: ChainCapableConnector): boolean {
  if (typeof connector.getChainId === "function") {
    return false;
  }
  if (typeof connector.getProvider !== "function") {
    return false;
  }
  connector.getChainId = async () => {
    const provider = await connector.getProvider?.();
    const providerWithRequest =
      typeof provider === "object" &&
      provider !== null &&
      "request" in provider &&
      typeof (provider as { request?: unknown }).request === "function"
        ? (provider as { request: (input: { method: string }) => Promise<unknown> })
        : null;
    if (!providerWithRequest) {
      throw new Error("wallet provider is unavailable");
    }
    const rawChainId = await providerWithRequest.request({ method: "eth_chainId" });
    const chainId = parseChainId(rawChainId);
    if (chainId === null) {
      throw new Error("wallet chain id is unavailable");
    }
    return chainId;
  };
  return true;
}

export function ensureWagmiConnectorCompatibility(config: Config = getWagmiConfig()): void {
  const patchedByUid = new Map<string, ChainCapableConnector>();
  const configured = [...(config.connectors ?? [])] as unknown as ChainCapableConnector[];
  for (const connector of configured) {
    patchConnectorGetChainId(connector);
    if (typeof connector.uid === "string") {
      patchedByUid.set(connector.uid, connector);
    }
  }

  const currentConnections = config.state.connections;
  let replacedAny = false;
  const nextConnections = new Map(currentConnections);
  for (const [uid, connection] of nextConnections) {
    const current = connection as typeof connection & { connector: ChainCapableConnector };
    const existing = current.connector;
    if (typeof existing.getChainId === "function") {
      continue;
    }
    const replacement =
      patchedByUid.get(uid) ??
      configured.find((connector) => connector.id === existing.id);
    if (!replacement) {
      patchConnectorGetChainId(existing);
      continue;
    }
    patchConnectorGetChainId(replacement);
    nextConnections.set(uid, {
      ...connection,
      connector: replacement as typeof connection.connector,
    });
    replacedAny = true;
  }

  if (replacedAny) {
    config.setState((state) => ({
      ...state,
      connections: nextConnections,
    }));
  }
}

ensureWagmiConnectorCompatibility(getWagmiConfig());
