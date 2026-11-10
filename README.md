# kPEG

`kPEG` is a fixed-supply ERC20 token and live onchain collectible system on Base, built around a real Uniswap v4 pool, a custom v4 hook/router/quoter, an escrow P2P marketplace, immutable onchain `32x32` pixel kitty art, a libSQL/SQLite indexer API, and a React web app.

---

## Table of Contents

1. [Overview & Core Mechanics](#1-overview--core-mechanics)
2. [Quickstart: Run the Local Demo (`pnpm demo`)](#2-quickstart-run-the-local-demo-pnpm-demo)
3. [Architecture & Monorepo Layout](#3-architecture--monorepo-layout)
4. [Local Development & Verification](#4-local-development--verification)
5. [Testnet Deployment (Base Sepolia)](#5-testnet-deployment-base-sepolia)
6. [Production Deployment (Base Mainnet + Turso + Vercel)](#6-production-deployment-base-mainnet--turso--vercel)
7. [Trait, Compatibility & Rarity Reference](#7-trait-compatibility--rarity-reference)
8. [Sources & License](#8-sources--license)

---

## 1. Overview & Core Mechanics

- **Fixed supply:** `9,999 kPEG` (`TOKEN_SUPPLY_FIXED = 9,999 ether`).
- **1 whole token = 1 live kitty:** Every whole `1.0 kPEG` (`1e18`) held by a user maps to `1` live onchain kitty. Fractional balances do not mint kitties.
- **Minting via Uniswap v4 buys:** Buying whole `kPEG` from the Uniswap v4 pool mints `floor(amountOut / 1e18)` kitties in a single `O(1)` batch (`KittyBatchMinted`).
- **Automatic balance reconciliation:** Selling or transferring `kPEG` below whole-token boundaries automatically moves or burns kitties so live collectibles always match whole-token balances (`kittiesLive` decreases on burn; `kittiesEverMinted` is cumulative).
- **Preserving specific kitties:**
  - `directTransferKitty(kittyId, to)` and `directTransferKittiesList(kittyIds, to)` move exact kitty IDs along with `1.0 kPEG` per kitty.
  - `KPEGMarket` provides atomic P2P escrow listings (`createTradeAndFund`) for single kitties or bundles of up to `100` kitties without mutating their traits or art.
- **Early buy throttle (`maxBuy()`):** Starts at `0.25%` of supply (`24.9975 kPEG`) when the pool starts, grows by `0.003%` of supply per second, and caps at `9,999 kPEG`.
- **Reserve exemption:** The deployer wallet is marked `notMintableAccount` so initial pool seeding and reserve operations never mint kitties to the deployer.
- **Deterministic `32x32` onchain SVG art:**
  - `KPEGRenderer` and packed `KPEGArtSource*` contracts store the `32x32` chibi kitty pixel layers onchain.
  - `kittySvg(kittyId)`, `kittyTraits(kittyId)`, and `tokenURI(kittyId)` reconstruct traits and SVG directly onchain from batch seed metadata.
  - The indexer and browser use the exact same trait-layer source (`docs/traits/traits.json` $\rightarrow$ `packages/core`) and entropy rules, avoiding per-kitty RPC calls during batch indexing.

---

## 2. Quickstart: Run the Local Demo (`pnpm demo`)

You can launch a complete local environment—including a local Hardhat chain, deployed `kPEG` + Uniswap v4 contracts, seeded liquidity, **56 live kitties**, **3 open P2P market listings**, a completed market sale, the indexer API, and the web UI—with two commands:

```bash
pnpm install
pnpm demo
```

### What `pnpm demo` does automatically

1. Starts a local Hardhat node on `http://127.0.0.1:8545` (Chain ID `31337`).
2. Builds `@kpeg/core` and deploys the full contract suite (`KPEGToken`, `KPEGRenderer`, `KPEGHook`, `KPEGMarket`, `KPEGV4Router`, `KPEGV4Quoter`, and local Uniswap v4 `PoolManager` / `PositionManager`).
3. Initializes the Uniswap v4 pool at `1 kPEG = 1 ETH` and seeds `1,000 kPEG + 1,000 ETH` of liquidity.
4. Advances the local chain clock past the initial `maxBuy()` throttle and executes demo trades across 3 wallets (`seed:localhost`):
   - Mints **58 kitties** across multiple batch sizes (`56` live after 1 partial sell/burn).
   - Creates **3 open market listings** (single kitty + multi-kitty bundles) and **1 completed market sale**.
   - Executes **1 direct kitty transfer**.
5. Generates a root `.env` configured for `localhost` + local SQLite (`./apps/indexer/data/kpeg.sqlite`).
6. Boots the indexer API (`http://127.0.0.1:8787`) and Vite web server (`http://localhost:5173`).

### Try the demo in your browser

Open **`http://localhost:5173`**:

- **EXPLORE:** Browse the 56 live kitties, filter by trait text or `#id`, sort by `LATEST` or `SCARCITY`, and click any card to inspect its `32x32` artwork, `BORN` block provenance, and per-trait rarity odds.
- **MARKET:** Browse open single and bundle listings, or switch to `SOLD` to inspect completed trade history.
- **TRADE & MY COLLECTIONS (Optional Wallet Connection):**
  To test buying, selling, transferring, or listing from the UI, add network `http://127.0.0.1:8545` (Chain ID `31337`) to MetaMask or Rabby and import one of the pre-funded demo accounts printed in the terminal:

| Role | Address | Private Key | Initial State |
| --- | --- | --- | --- |
| **Alice** | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` | 35 live kitties + 2 open market listings |
| **Bob** | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` | 11 live kitties + 1 open market listing |
| **Carol** | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` | 5 live kitties |

> **Note:** Do not use Hardhat Account #0 (`0xf39Fd6...`) to test kitty minting—it is the deployer/reserve wallet (`notMintableAccount`) and never mints kitties on whole-token buys.

---

## 3. Architecture & Monorepo Layout

```text
.
├── contracts/        # Solidity contracts (KPEGToken, KPEGRenderer, KPEGHook, KPEGMarket, KPEGV4Router, KPEGV4Quoter)
├── packages/core/    # Shared deterministic trait generator, rarity math, compatibility rules, SVG renderer, ABIs
├── apps/indexer/     # Fastify + Serverless API and chain log indexer (SQLite locally, Turso/libSQL in production)
├── apps/web/         # React 19 + Vite + Tailwind v4 + wagmi/viem frontend (Explore, Trade, Market, My Collections)
├── scripts/          # Root orchestration scripts (demo-local, e2e-local, write-app-env, trait art generators)
└── docs/traits/      # Canonical 32x32 pixel trait matrix source (traits.json)
```

### Key Design Decisions

- **Real Uniswap v4 trading path:** `apps/web` quotes via `KPEGV4Quoter` and swaps via `KPEGV4Router.buyExactKPEG` / `sellExactKPEG` against an official Uniswap v4 `PoolManager` with a mined-permission `KPEGHook` (`afterAddLiquidity` + `afterSwap`).
- **Single root `.env`:** All packages read from one `.env` at the repository root. Never create per-package `.env` files.
- **SQLite locally, Turso/libSQL in production:** Local dev uses zero-setup SQLite (`./apps/indexer/data/kpeg.sqlite`), while serverless production uses remote Turso/libSQL with a DB lease lock so only one writer indexes chain logs at a time.

---

## 4. Local Development & Verification

### Automated Verification Gate

Run the full build, unit test suite (`contracts`, `core`, `indexer`, `web`), and automated local E2E flow:

```bash
pnpm verify
```

Or run individual commands:

```bash
pnpm build          # Compile core, contracts, indexer, and web
pnpm test           # Run unit and integration tests across all workspaces
pnpm e2e:local      # Run isolated local chain + deploy + swap/market/transfer/sell E2E check
```

### Manual Step-by-Step Local Run

If you prefer running each local service in its own terminal instead of `pnpm demo`:

1. **Start the local Hardhat chain:**
   ```bash
   pnpm --filter @kpeg/contracts exec hardhat node --hostname 127.0.0.1 --port 8545
   ```
2. **Deploy contracts (writes `deployments/localhost.json`):**
   ```bash
   KPEG_LOCAL_RPC_URL=http://127.0.0.1:8545 pnpm --filter @kpeg/contracts deploy:localhost
   ```
3. **Initialize pool price and seed initial liquidity:**
   ```bash
   KPEG_LOCAL_RPC_URL=http://127.0.0.1:8545 \
   pnpm --filter @kpeg/contracts bootstrap:localhost -- \
     --price-kpeg-per-eth 1 \
     --token-liquidity 1000 \
     --eth-liquidity 1000
   ```
4. **Optional — seed demo kitties and market listings:**
   ```bash
   KPEG_LOCAL_RPC_URL=http://127.0.0.1:8545 pnpm --filter @kpeg/contracts seed:localhost
   ```
5. **Generate root `.env` from `deployments/localhost.json`:**
   ```bash
   node scripts/write-app-env.mjs localhost local-sqlite
   pnpm assert:app-env
   ```
6. **Start the API and web dev servers:**
   ```bash
   pnpm dev
   ```
   *(Or run `pnpm dev:api` and `pnpm dev:web` in separate terminals.)*

### Optional Local Liquidity Helpers

Add or withdraw Uniswap v4 liquidity from any wallet:

```bash
# Add liquidity (mints a PositionManager LP NFT)
KPEG_LIQUIDITY_PRIVATE_KEY=0x<private-key> \
KPEG_LOCAL_RPC_URL=http://127.0.0.1:8545 \
pnpm --filter @kpeg/contracts add-liquidity:localhost -- \
  --token-liquidity 100 \
  --eth-liquidity 1

# Withdraw liquidity (burns the LP NFT and returns underlying tokens)
KPEG_LIQUIDITY_PRIVATE_KEY=0x<private-key> \
KPEG_LOCAL_RPC_URL=http://127.0.0.1:8545 \
pnpm --filter @kpeg/contracts withdraw-liquidity:localhost -- \
  --token-id 1
```

### Regenerating Trait Artwork Artifacts

If you edit the canonical `32x32` pixel layers in `docs/traits/traits.json`:

```bash
pnpm optimize:trait-art   # Quantize color noise while preserving 32x32 pixel coordinates
pnpm generate:trait-art   # Regenerate packages/core/src/generated/traitArt.ts and contracts/src/generated/*
```

---

## 5. Testnet Deployment (Base Sepolia)

Known live Base Sepolia (`84532`) infrastructure addresses (built into `contracts/scripts/deploy.ts`):

- **Uniswap v4 PoolManager:** `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408`
- **Uniswap v4 PositionManager:** `0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80`
- **Permit2:** `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- **WETH9:** `0x4200000000000000000000000000000000000006`
- **Public RPC fallback:** `https://sepolia.base.org`

### 1) Configure `.env`

```bash
cp .env.example .env
```

Set the Base Sepolia operator inputs in `.env`:

```dotenv
KPEG_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_SEPOLIA_RPC=https://YOUR_BACKEND_UNRESTRICTED_RPC
BASE_SEPOLIA_RPC_PUBLIC=https://sepolia.base.org
KPEG_DEPLOYER_PRIVATE_KEY=0xYOUR_BASE_SEPOLIA_PRIVATE_KEY
VITE_REOWN_PROJECT_ID=<from your Reown Cloud project>
VITE_KPEG_NORMAL_REFETCH_MS=30000
```

### 2) Deploy Contracts

```bash
pnpm --filter @kpeg/contracts deploy:base-sepolia
```

This validates live target bytecode (`PoolManager`, `WETH`, `Permit2`, `PositionManager`) and writes `deployments/baseSepolia.json`.

### 3) Optional: Reserve Future v2 Breeding Gateway Before Pool Start

If you want to lock a deterministic CREATE2 authorization for the v2 breeding gateway before starting the token:

```bash
export KPEG_BREEDING_CREATE2_SALT=0x$(openssl rand -hex 32)
pnpm --filter @kpeg/contracts prepare-breeding-gateway:base-sepolia
pnpm --filter @kpeg/contracts set-breeding-auth:base-sepolia
```

*(At v2 launch time, deploy with `deploy-breeding-gateway:base-sepolia` and `deploy-breeding:base-sepolia`.)*

### 4) Initialize Pool Price & Seed Launch Liquidity

```bash
KPEG_BOOTSTRAP_PRIVATE_KEY=0xYOUR_BASE_SEPOLIA_PRIVATE_KEY \
pnpm --filter @kpeg/contracts bootstrap:base-sepolia -- \
  --price-kpeg-per-eth 1000000 \
  --token-liquidity 1000 \
  --eth-liquidity 0.001
```

### 5) Generate App Environment Variables

Choose one target mode:

```bash
# Option A: Local web + local SQLite
node scripts/write-app-env.mjs base-sepolia local-sqlite

# Option B: Local web + remote Turso DB
TURSO_DB_NAME=<your-testnet-turso-db> node scripts/write-app-env.mjs base-sepolia local-turso

# Option C: Cloud serverless web/API (Vercel) + Turso DB
TURSO_DB_NAME=<your-testnet-turso-db> node scripts/write-app-env.mjs base-sepolia cloud-turso
```

Verify the generated configuration:

```bash
pnpm assert:app-env
```

- For **local targets** (`local-sqlite` / `local-turso`), run `pnpm dev` and open `http://localhost:5173`.
- For **cloud targets** (`cloud-turso`), import `.env` into Vercel, deploy, and run `pnpm smoke:api https://<your-testnet-domain>`.

---

## 6. Production Deployment (Base Mainnet + Turso + Vercel)

Known live Base Mainnet (`8453`) infrastructure addresses:

- **Uniswap v4 PoolManager:** `0x498581ff718922c3f8e6a244956af099b2652b2b`
- **Uniswap v4 PositionManager:** `0x7c5f5a4bbd8fd63184577525326123b519429bdc`
- **Permit2:** `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- **WETH9:** `0x4200000000000000000000000000000000000006`
- **Public RPC fallback:** `https://mainnet.base.org`

### 1) Install Turso CLI & Prepare `.env`

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth signup
cp .env.example .env
```

Populate `.env` with dedicated mainnet RPCs and your deployer key:

```dotenv
KPEG_BASE_MAINNET_RPC_URL=https://YOUR_OPERATOR_BASE_RPC
BASE_RPC=https://YOUR_BACKEND_UNRESTRICTED_BASE_RPC
BASE_RPC_PUBLIC=https://YOUR_BROWSER_PUBLIC_BASE_RPC
KPEG_DEPLOYER_PRIVATE_KEY=0xYOUR_BASE_MAINNET_PRIVATE_KEY
VITE_REOWN_PROJECT_ID=<from your Reown Cloud project>
VITE_KPEG_NORMAL_REFETCH_MS=30000
```

### 2) Deploy Contracts & Verify on BaseScan

```bash
pnpm --filter @kpeg/contracts deploy:base-mainnet
```

Optional pre-start breeding gateway reservation:

```bash
export KPEG_BREEDING_CREATE2_SALT=0x$(openssl rand -hex 32)
pnpm --filter @kpeg/contracts prepare-breeding-gateway:base-mainnet
pnpm --filter @kpeg/contracts set-breeding-auth:base-mainnet
```

Verify all project-owned contracts on BaseScan using an Etherscan v2 API key:

```bash
pnpm --filter @kpeg/contracts verify:base-mainnet:dry-run
ETHERSCAN_API_KEY=<your-api-key> pnpm --filter @kpeg/contracts verify:base-mainnet
```

### 3) Bootstrap Pool Price & Initial Liquidity

```bash
KPEG_BOOTSTRAP_PRIVATE_KEY=0xYOUR_MAINNET_PRIVATE_KEY \
pnpm --filter @kpeg/contracts bootstrap:base-mainnet -- \
  --price-kpeg-per-eth 9000 \
  --token-liquidity 9000 \
  --eth-liquidity 1
```

### 4) Generate Production App Env & Initialize Turso Schema

```bash
TURSO_DB_NAME=<your-prod-turso-db> node scripts/write-app-env.mjs base-mainnet cloud-turso
pnpm assert:app-env
pnpm --filter @kpeg/indexer init-db
```

`write-app-env.mjs` creates the Turso database if needed, generates `KPEG_SYNC_SECRET`, and strips `KPEG_DEPLOYER_PRIVATE_KEY` from `.env` so it is safe to import into Vercel.

### 5) Deploy Serverless Web + API on Vercel

Configure the Vercel project with:

- **Root Directory:** `apps/web`
- **Install Command:** `pnpm install --frozen-lockfile`
- **Build Command:** `pnpm --filter @kpeg/core build && pnpm --filter @kpeg/indexer build && pnpm --filter @kpeg/web build`
- **Output Directory:** `dist`
- **Environment Variables:** Import the generated root `.env`

After deployment, run the API smoke check and region co-location check:

```bash
pnpm smoke:api https://<your-prod-domain>
pnpm inspect:region https://<your-prod-domain>
pnpm measure:kpis https://<your-prod-domain> 8
```

### 6) Configure 1-Minute Background Sync Scheduler (Google Cloud Scheduler)

For serverless hosts without sub-minute cron, trigger `GET /api/sync` every minute with `Authorization: Bearer <KPEG_SYNC_SECRET>`:

```bash
pnpm sync:scheduler:env base-mainnet --app-url https://<your-prod-domain>
source .env.scheduler
SCHEDULE='* * * * *'
gcloud services enable cloudscheduler.googleapis.com

gcloud scheduler jobs create http "$KPEG_SYNC_SCHEDULER_JOB_NAME" \
  --location="$KPEG_SYNC_SCHEDULER_LOCATION" \
  --schedule="$SCHEDULE" \
  --time-zone="$KPEG_SYNC_TIMEZONE" \
  --uri="$KPEG_SYNC_SCHEDULER_TARGET_URL" \
  --http-method=GET \
  --headers="Authorization=Bearer $KPEG_SYNC_SECRET" \
  --attempt-deadline=30s
```

### 7) Operator Helpers & Ownership Renouncement

- **Batch transfer owned kitties by final rarity tier (`directTransferKittiesList`):**
  ```bash
  KPEG_TRANSFER_KITTIES_PRIVATE_KEY=0xYOUR_KEY \
  pnpm --filter @kpeg/contracts transfer-kitties-by-tier:base-mainnet -- \
    --receiver 0xRECEIVER_ADDRESS \
    --tier Legendary \
    --dry-run
  ```
- **Chunked router sell under provider gas caps (`KPEGV4Router.sellExactKPEG`):**
  ```bash
  KPEG_SELL_PRIVATE_KEY=0xYOUR_KEY \
  pnpm --filter @kpeg/contracts sell:base-mainnet -- --whole max --dry-run
  ```
- **Irreversible ownership renouncement (run only after bootstrap, breeding auth, and production verification):**
  ```bash
  KPEG_CONFIRM_MARKET_FINAL=1 \
  KPEG_CONFIRM_RENOUNCE_OWNERSHIP=I_UNDERSTAND_THIS_IS_IRREVERSIBLE \
  pnpm --filter @kpeg/contracts renounce-ownership:base-mainnet
  ```

---

## 7. Trait, Compatibility & Rarity Reference

### Trait Families & Combination Counts

- **8 Onchain Trait Families (`32x32` canvas):**
  - Backgrounds (`6`), Breeds (`20`), Clothes (`18`), Mood (`12`), Marks (`4`), Mouths (`12`), Eyes (`12`), Accessories (`17`).
- **Combination math:**
  - Naive combinations: `6 × 20 × 18 × 12 × 4 × 12 × 12 × 17 = 253,808,640`
  - Valid combinations after compatibility rules: `172,397,520` (`32.08%` filtered out)

### Tier Model

- **Mint Tier (determined by whole `kPEG` bought in one swap):**
  - `Common`: `1–9` | `Uncommon`: `10–49` | `Rare`: `50–99` | `Epic`: `100–249` | `Legendary`: `250+`
- **kPEG Tier & Rarity Metrics (per kitty):**
  - `Mint Tier` biases trait-weight tables at generation time.
  - `TRAIT RARITY` = exact normalized probability for each trait in that kitty's generation context after compatibility filtering.
  - `RARITY` = exact generation probability for the full 8-trait combination (`0.0ₙ...%` notation when leading zeroes exceed 3).
  - `Rarity Score` = `round(log10(global 1 in N) * 100)`.
  - `kPEG Tier` = final tier derived from `RARITY` percentage cutoffs (`Common >> Uncommon >> Rare >> Epic >> Legendary`).

### Compatibility Rules

- **Breed / Background:** `Siamese`, `Ragdoll`, and `Calico` cannot use `White`; `Bombay` cannot use `Midnight`.
- **Breed / Clothes:**
  - `Abyssinian` and `Nebelung` cannot pair with `Frog Onesie`.
  - `Sphynx` cannot pair with `Cozy Hoodie`, `Sailor Shirt`, `Frog Onesie`, `Pink Scarf`, `Yellow Raincoat`, `Purple Sweater`, `Meteor Hoodie`, or `Wizard Hat`.
  - `Alien Cat` cannot pair with `Cozy Hoodie`, `Sailor Shirt`, `Frog Onesie`, `Dino Costume`, `Yellow Raincoat`, `Purple Sweater`, `Meteor Hoodie`, `Moon Cloak`, `Silk Sash`, `Star Cape`, or `Wizard Hat`.
  - `Meteor Hoodie`, `Moon Cloak`, `Silk Sash`, and `Star Cape` cannot pair with `Siamese`, `Persian`, `Ragdoll`, or `Alien Cat` (`Meteor Hoodie` also excludes `Sphynx`).
  - `Wizard Hat` cannot pair with `Bombay`, `Devon Rex`, `Sphynx`, or `Alien Cat`.
- **Breed / Mouth:** `Sphynx` cannot pair with `Happy V` or `Grumpy`; `Alien Cat` cannot pair with `Happy V`.
- **Breed / Marks:** `Sphynx`, `Tuxedo`, and `Alien Cat` cannot pair with `Cream Muzzle`.
- **Breed / Accessory:** `Sphynx` cannot pair with `Star Pin` or `Heart Charm`.
- **Clothes / Accessory:**
  - `Star Pin`, `Heart Charm`, `ETH Pendant`, and `BTC Tag` cannot pair with `Red Bandana`, `Green Bandana`, `Blue Bowtie`, `Pink Scarf`, or `Gold Collar`.
  - `Space Helmet` forces Accessory to `None` and allows only `None`, `Blush`, or `Cream Muzzle` marks.
  - `Gold Crown` cannot pair with `Frog Onesie`, `Dino Costume`, or `Space Helmet`.
- **Mood / Mouth & Background:** `Sleep Zzz` cannot pair with `Happy V` or `Tongue Out`; `Aurora` pairs only with `Lilac` or `Midnight` backgrounds.

### Base Mint Odds By Tier

<details>
<summary><strong>Expand Base Trait Probability Tables (Breed, Clothes, Mood, Marks, Mouth, Eyes, Accessory, Background)</strong></summary>

#### Breed Odds By Tier

| Breed | Common | Uncommon | Rare | Epic | Legendary |
| --- | ---: | ---: | ---: | ---: | ---: |
| American Shorthair | 13% | 9% | 6% | 5% | 3% |
| British Shorthair | 12% | 8% | 6% | 5% | 3% |
| Siamese | 6% | 7% | 8% | 7% | 8% |
| Persian | 8% | 7% | 5% | 5% | 4% |
| Maine Coon | 5% | 7% | 8% | 7% | 8% |
| Bengal | 3% | 5% | 8% | 9% | 12% |
| Scottish Fold | 8% | 6% | 5% | 4% | 2% |
| Munchkin | 8% | 6% | 5% | 3% | 2% |
| Ragdoll | 2% | 5% | 7% | 7% | 10% |
| Calico | 6% | 6% | 7% | 6% | 6% |
| Bombay | 6% | 5% | 4% | 4% | 3% |
| Norwegian Forest | 2% | 4% | 6% | 10% | 12% |
| Abyssinian | 6% | 6% | 5% | 5% | 5% |
| Devon Rex | 2% | 3% | 3% | 3% | 3% |
| Russian Blue | 4% | 4% | 4% | 4% | 4% |
| Sphynx | 1% | 2% | 2% | 2% | 2% |
| Turkish Van | 4% | 4% | 3% | 3% | 3% |
| Tuxedo | 3% | 3% | 3% | 3% | 2% |
| Nebelung | 1% | 2% | 4% | 5% | 5% |
| Alien Cat | 0% | 1% | 1% | 3% | 3% |

#### Clothes Odds By Tier

| Clothes | Common | Uncommon | Rare | Epic | Legendary |
| --- | ---: | ---: | ---: | ---: | ---: |
| None | 30% | 23% | 19% | 14% | 12% |
| Red Bandana | 15% | 13% | 11% | 9% | 7% |
| Green Bandana | 13% | 11% | 9% | 8% | 7% |
| Blue Bowtie | 10% | 9% | 8% | 7% | 6% |
| Cozy Hoodie | 7% | 8% | 8% | 7% | 6% |
| Sailor Shirt | 7% | 8% | 8% | 7% | 7% |
| Frog Onesie | 4% | 5% | 6% | 7% | 7% |
| Dino Costume | 3% | 4% | 5% | 6% | 8% |
| Pink Scarf | 4% | 5% | 6% | 7% | 6% |
| Yellow Raincoat | 3% | 4% | 5% | 6% | 5% |
| Purple Sweater | 2% | 3% | 4% | 5% | 5% |
| Gold Collar | 1% | 1% | 2% | 2% | 3% |
| Space Helmet | 1% | 1% | 1% | 2% | 3% |
| Meteor Hoodie | 0% | 1% | 2% | 3% | 4% |
| Moon Cloak | 0% | 1% | 2% | 3% | 4% |
| Silk Sash | 0% | 1% | 2% | 3% | 4% |
| Star Cape | 0% | 1% | 1% | 2% | 3% |
| Wizard Hat | 0% | 1% | 1% | 2% | 3% |

#### Mood Odds By Tier

| Mood | Common | Uncommon | Rare | Epic | Legendary |
| --- | ---: | ---: | ---: | ---: | ---: |
| None | 47% | 42% | 34% | 28% | 23% |
| Sparkles | 9% | 9% | 8% | 7% | 6% |
| Hearts | 7% | 8% | 8% | 7% | 6% |
| Sleep Zzz | 11% | 10% | 10% | 9% | 8% |
| Sweat Drop | 10% | 10% | 9% | 8% | 7% |
| Coin Glow | 7% | 8% | 10% | 12% | 14% |
| Purple Moon | 2% | 4% | 7% | 11% | 14% |
| Fireflies | 3% | 4% | 5% | 6% | 6% |
| Lucky Breeze | 3% | 3% | 4% | 4% | 4% |
| Tiny Storm | 1% | 1% | 2% | 3% | 4% |
| Aurora | 0% | 1% | 2% | 3% | 5% |
| Moonlit | 0% | 0% | 1% | 2% | 3% |

#### Marks Odds By Tier

| Marks | Common | Uncommon | Rare | Epic | Legendary |
| --- | ---: | ---: | ---: | ---: | ---: |
| None | 56% | 48% | 40% | 34% | 30% |
| Blush | 20% | 24% | 26% | 26% | 25% |
| Cream Muzzle | 18% | 19% | 20% | 20% | 20% |
| Tiny Scar | 6% | 9% | 14% | 20% | 25% |

#### Mouth Odds By Tier

| Mouth | Common | Uncommon | Rare | Epic | Legendary |
| --- | ---: | ---: | ---: | ---: | ---: |
| Happy V | 23% | 20% | 17% | 14% | 11% |
| Smiling W | 20% | 18% | 16% | 14% | 12% |
| Pout | 12% | 12% | 12% | 11% | 10% |
| Stoic | 15% | 14% | 12% | 10% | 8% |
| Wonder O | 6% | 8% | 11% | 14% | 16% |
| Tongue Out | 6% | 8% | 11% | 15% | 18% |
| Calm Smile | 7% | 6% | 5% | 4% | 4% |
| Grumpy | 4% | 4% | 4% | 4% | 4% |
| Smirk | 3% | 3% | 3% | 4% | 4% |
| Yawn | 2% | 3% | 3% | 3% | 5% |
| Tiny Fang | 1% | 2% | 3% | 4% | 5% |
| Fishy Bite | 1% | 2% | 3% | 3% | 3% |

#### Eyes Odds By Tier

| Eyes | Common | Uncommon | Rare | Epic | Legendary |
| --- | ---: | ---: | ---: | ---: | ---: |
| Happy ^_^ | 24% | 22% | 18% | 14% | 11% |
| Blue Eyes | 18% | 17% | 15% | 13% | 12% |
| Winking | 14% | 13% | 12% | 11% | 9% |
| Amber Eyes | 15% | 14% | 13% | 12% | 12% |
| Bored Eyes | 14% | 12% | 10% | 9% | 8% |
| Heterochromia | 3% | 4% | 6% | 7% | 9% |
| Emerald Eyes | 4% | 5% | 7% | 8% | 10% |
| Sleepy | 4% | 6% | 9% | 11% | 14% |
| Crossed Eyes | 2% | 3% | 3% | 3% | 2% |
| Glassy Eyes | 1% | 2% | 3% | 4% | 5% |
| Gold Eyes | 1% | 2% | 3% | 5% | 5% |
| Void Eyes | 0% | 0% | 1% | 3% | 3% |

#### Accessory Odds By Tier

| Accessory | Common | Uncommon | Rare | Epic | Legendary |
| --- | ---: | ---: | ---: | ---: | ---: |
| None | 39% | 30% | 22% | 14% | 10% |
| Gold Crown | 4% | 4% | 4% | 5% | 5% |
| Fish Snack | 17% | 13% | 9% | 7% | 6% |
| Yarn Ball | 0% | 4% | 7% | 8% | 8% |
| Star Pin | 7% | 6% | 5% | 4% | 3% |
| Round Glasses | 9% | 8% | 7% | 6% | 5% |
| Heart Charm | 7% | 8% | 8% | 9% | 8% |
| ETH Pendant | 5% | 7% | 10% | 11% | 12% |
| BTC Tag | 3% | 7% | 10% | 12% | 14% |
| Cat Wand | 0% | 1% | 2% | 3% | 4% |
| Comet Charm | 0% | 0% | 1% | 2% | 3% |
| Crystal Ball | 0% | 1% | 2% | 3% | 4% |
| Feather Teaser | 5% | 5% | 4% | 3% | 2% |
| Lucky Coin | 1% | 2% | 3% | 5% | 5% |
| Magic Wand | 0% | 1% | 2% | 3% | 4% |
| Moonfish | 0% | 1% | 2% | 3% | 4% |
| Tiny Bell | 3% | 2% | 2% | 2% | 3% |

#### Background Odds By Tier

| Background | Common | Uncommon | Rare | Epic | Legendary |
| --- | ---: | ---: | ---: | ---: | ---: |
| White | 28% | 24% | 20% | 18% | 16% |
| Sky | 22% | 21% | 20% | 19% | 19% |
| Mint | 22% | 21% | 20% | 19% | 19% |
| Coral | 16% | 16% | 16% | 16% | 16% |
| Lilac | 8% | 10% | 12% | 13% | 14% |
| Midnight | 4% | 8% | 12% | 15% | 16% |

</details>

---

## 8. Sources & License

- **References:**
  - [Uniswap v4 Deployments](https://developers.uniswap.org/docs/protocols/v4/deployments)
  - [uPEG Reference](https://unipeg.art)
- **License:** Released under the [MIT License](./LICENSE).
