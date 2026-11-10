import { config as loadEnv } from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import { resolve } from "node:path";
import { explorerApiKey } from "./scripts/verify-env";

loadEnv({ path: resolve(__dirname, "../.env"), override: true });

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function envOrDefault(name: string, fallback: string): string {
  const value = envValue(name);
  return value && value.length > 0 ? value : fallback;
}

function deployerAccounts(): string[] {
  const privateKey = envValue("KPEG_DEPLOYER_PRIVATE_KEY");
  return privateKey ? [privateKey] : [];
}

function localAccounts(): string[] {
  const privateKey = envValue("KPEG_LOCAL_PRIVATE_KEY");
  return privateKey ? [privateKey] : [];
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.26",
        settings: {
          evmVersion: "cancun",
          optimizer: {
            enabled: true,
            runs: 500
          }
        }
      },
      {
        version: "0.8.17",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 500
          }
        }
      }
    ],
    overrides: {
      "src/KPEGBreeding.sol": {
        version: "0.8.26",
        settings: {
          evmVersion: "cancun",
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 500
          }
        }
      }
    }
  },
  paths: {
    sources: "./src",
    tests: "./test"
  },
  networks: {
    localhost: {
      url: process.env.KPEG_LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
      ...(localAccounts().length > 0 ? { accounts: localAccounts() } : {})
    },
    baseSepolia: {
      url: envOrDefault("KPEG_BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org"),
      chainId: 84532,
      accounts: deployerAccounts()
    },
    baseMainnet: {
      url: envOrDefault("KPEG_BASE_MAINNET_RPC_URL", "https://mainnet.base.org"),
      chainId: 8453,
      accounts: deployerAccounts()
    }
  },
  etherscan: {
    apiKey: explorerApiKey()
  },
  sourcify: {
    enabled: envValue("KPEG_VERIFY_SOURCIFY") === "1"
  }
};

export default config;
