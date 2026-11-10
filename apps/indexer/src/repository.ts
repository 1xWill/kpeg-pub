import {
  ACCESSORIES,
  ACCESSORY_WEIGHTS_BY_TIER,
  BACKGROUNDS,
  BACKGROUND_WEIGHTS_BY_TIER,
  MARKS,
  MARKS_WEIGHTS_BY_TIER,
  MOODS,
  MOOD_WEIGHTS_BY_TIER,
  BREED_WEIGHTS_BY_TIER,
  CLOTHES_WEIGHTS_BY_TIER,
  EYES_WEIGHTS_BY_TIER,
  MOUTH_WEIGHTS_BY_TIER,
  computeGlobalRarity,
  computeCompatibilityReduction,
  computeFilteredCombinationCountByManifest,
  computeNaiveCombinationCount,
  documentedFilteredCombinationCount,
  generateKPEG,
  generateKPEGFromOnchainEntropy,
  generateKPEGFromSeed,
  kpegTierFromRarityPct,
  TIER_LABELS,
  isAccessoryAllowed,
  isBackgroundAllowedForBreed,
  isMarkAllowed,
  isMoodAllowed,
  type GeneratedKPEG,
  type TraitOdds,
  type Tier
} from "@kpeg/core";
import type { DbAdapter } from "./db.js";

const FIXED_TOKEN_SUPPLY = 9_999;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type SortMode = "latest" | "scarcity";

type KittyRow = {
  id: number;
  seed: string;
  tier: number;
  tier_label: string;
  owner: string;
  minted_by: string;
  mint_batch_size: number;
  created_at: number;
  updated_at: number;
  block_number: number;
  tx_hash: string;
  gas_used: number | null;
  base_fee_wei: string | null;
  burned_at: number | null;
  rarity_score: number;
  kpeg_rarity_pct: number;
  kpeg_rarity_one_in_n: number;
  traits_json: string;
  trait_odds_json: string;
};

type MarketStatus = "OPEN" | "SOLD" | "DELETED";

type MarketListingRow = {
  trade_id: number;
  escrow_address: string;
  seller: string;
  buyer: string | null;
  payment_token: string;
  price_wei: string;
  fee_bps: number;
  kitty_ids_json: string;
  kitty_count: number;
  status: MarketStatus;
  created_block: number;
  created_tx_hash: string;
  created_at: number;
  updated_at: number;
  closed_block: number | null;
  closed_tx_hash: string | null;
  closed_at: number | null;
};

type OwnerAggregateRow = {
  owner: string;
  current_kitties: number;
  ever_kitties: number;
};

type GlobalStatsRow = {
  kitties_live: number;
  kitties_ever_minted: number;
  holders_live: number;
  holders_ever: number;
};

type SyncStatusRow = {
  last_sync_success_at_ms: number | null;
  last_sync_failed_at_ms: number | null;
  last_sync_phase: string | null;
  last_sync_from_block: number | null;
  last_sync_to_block: number | null;
  last_sync_event_kind: string | null;
  last_sync_tx_hash: string | null;
  last_sync_log_index: number | null;
  last_sync_error: string | null;
};

type SyncSnapshotRow = {
  head_block: number | null;
  onchain_kitties_live: number | null;
  onchain_kitties_ever_minted: number | null;
  updated_at_ms: number;
};

type RepairJobRow = {
  job_name: string;
  version: number;
  status: string;
  from_block: number;
  next_block: number;
  target_block: number | null;
  updated_at_ms: number;
  last_error: string | null;
};

type BornLineageRow = {
  child_kitty_id: number;
  source: "BUY" | "BREEDING";
  parent_a_kitty_id: number | null;
  parent_b_kitty_id: number | null;
  created_at: number;
};

type BreedingPoolStatus = "OPEN" | "CYCLING" | "CANCELLED";

type BreedingPoolRow = {
  pool_id: number;
  pool_type: number | null;
  status: BreedingPoolStatus;
  host: string | null;
  joiner: string | null;
  parent_a_kitty_id: number | null;
  parent_b_kitty_id: number | null;
  cycle_started_at: number | null;
  cycle_days: number | null;
  filter_count: number | null;
  filter_groups_json: string | null;
  filter_traits_json: string | null;
  current_backing_provider: string | null;
  current_backing_kitty_id: number | null;
  current_backing_side: number | null;
  queued_backing_provider: string | null;
  queued_backing_kitty_id: number | null;
  queued_backing_side: number | null;
  last_result: number | null;
  child_tier: number | null;
  child_kitty_id: number | null;
  child_owner: string | null;
  child_seed_salt: string | null;
  child_packed_traits: string | null;
  updated_block: number;
  updated_at: number;
};

type BreedingClaimRow = {
  claim_id: number | null;
  pool_id: number;
  child_kitty_id: number;
  child_owner: string;
  claimed: number;
  created_block: number;
  created_at: number;
  claimed_block: number | null;
  claimed_at: number | null;
  claimed_tx_hash: string | null;
};

type BreedingEventRow = {
  id: number;
  pool_id: number;
  event_kind: string;
  result: number | null;
  parent_a_kitty_id: number | null;
  parent_b_kitty_id: number | null;
  child_kitty_id: number | null;
  tx_hash: string;
  block_number: number;
  log_index: number;
  payload_json: string;
  created_at: number;
};

export interface MintInput {
  owner: string;
  wholeBought: number;
  blockNumber?: number;
}

export interface TransferInput {
  kittyId: number;
  to: string;
  blockNumber?: number;
}

export interface BurnInput {
  owner: string;
  count: number;
  blockNumber?: number;
}

export interface ChainMintEventInput {
  kittyId: number;
  owner: string;
  mintedBy: string;
  tier: Tier;
  batchSizeWhole: number;
  seed: `0x${string}`;
  blockNumber: number;
  txHash: `0x${string}`;
  mintedAt?: number;
  gasUsed?: number | null;
  baseFeeWei?: string | null;
  traits?: GeneratedKPEG["traits"];
}

export interface BornMintTraitsOverrideInput {
  kittyId: number;
  traits: GeneratedKPEG["traits"];
  blockNumber: number;
  txHash: `0x${string}`;
  updatedAt?: number;
}

export interface ChainBurnEventInput {
  kittyId: number;
  owner: string;
  blockNumber: number;
}

export interface ChainMoveEventInput {
  kittyId: number;
  from: string;
  to: string;
  blockNumber: number;
}

export interface ChainIdentityInput {
  chainId: number;
  tokenAddress: string;
  marketAddress?: string | null;
}

export interface MarketPositionCreatedInput {
  tradeId: number;
  seller: string;
  escrowAddress: string;
  paymentToken: string;
  priceWei: string;
  feeBps: number;
  kittyIds: number[];
  blockNumber: number;
  txHash: `0x${string}`;
  createdAt?: number;
}

export interface MarketPositionDeletedInput {
  tradeId: number;
  seller: string;
  blockNumber: number;
  txHash: `0x${string}`;
  closedAt?: number;
}

export interface MarketPositionBoughtInput {
  tradeId: number;
  buyer: string;
  seller: string;
  priceWei: string;
  feeWei: string;
  blockNumber: number;
  txHash: `0x${string}`;
  soldAt?: number;
}

export interface MarketPositionParamsInput {
  tradeId: number;
  paymentToken: string;
  priceWei: string;
}

export interface TokenTransferEventInput {
  from: string;
  to: string;
  amountWei: string;
  blockNumber: number;
}

export type SyncFailurePhase =
  | "token-transfer-log-read"
  | "main-log-read"
  | "main-event-ingest"
  | "token-transfer-ingest"
  | "sync-transaction"
  | "cursor-advance";

export interface SyncFailureInput {
  failedAtMs?: number;
  phase: SyncFailurePhase;
  fromBlock?: number | null;
  toBlock?: number | null;
  eventKind?: string | null;
  txHash?: string | null;
  logIndex?: number | null;
  error: string;
}

export interface SyncFailureStatus {
  lastSyncSuccessAtMs: number | null;
  lastSyncFailedAtMs: number | null;
  lastSyncPhase: SyncFailurePhase | null;
  lastSyncFromBlock: number | null;
  lastSyncToBlock: number | null;
  lastSyncEventKind: string | null;
  lastSyncTxHash: string | null;
  lastSyncLogIndex: number | null;
  lastSyncError: string | null;
}

export interface BornLineageInput {
  childKittyId: number;
  source: "BUY" | "BREEDING";
  parentAKittyId?: number | null;
  parentBKittyId?: number | null;
  createdAt?: number;
}

export type RepairJobStatus = "pending" | "running" | "done" | "failed";

export interface RepairJobState {
  jobName: string;
  version: number;
  status: RepairJobStatus;
  fromBlock: number;
  nextBlock: number;
  targetBlock: number | null;
  updatedAtMs: number;
  lastError: string | null;
}

export interface OwnerKittyHistoryRepairInput {
  owner: string;
  kittyId: number;
  firstSeenAt: number;
}

export interface MarketSaleRepairInput {
  tradeId: number;
  seller: string;
  buyer: string;
  priceWei: string;
  feeWei: string;
  soldBlock: number;
  soldTxHash: string;
  soldAt: number;
}

export interface BreedingEventInput {
  eventKind:
    | "POOL_CREATED"
    | "POOL_JOINED"
    | "POOL_LEFT"
    | "CYCLE_RESET"
    | "SETTLED"
    | "LINEAGE"
    | "COOLDOWN_SET"
    | "CLAIMED"
    | "BACKING_STAKED"
    | "BACKING_WITHDRAWN"
    | "BACKING_CONSUMED"
    | "BACKING_PROMOTED";
  poolId: number;
  blockNumber: number;
  txHash: `0x${string}`;
  logIndex: number;
  payload?: Record<string, unknown>;
  poolType?: number;
  host?: string | null;
  joiner?: string | null;
  parentAKittyId?: number | null;
  parentBKittyId?: number | null;
  cycleStartedAt?: number | null;
  cycleDays?: number | null;
  filterCount?: number | null;
  filterGroups?: number[] | null;
  filterTraits?: number[] | null;
  nextStatus?: number | null;
  result?: number | null;
  childTier?: number | null;
  childKittyId?: number | null;
  childOwner?: string | null;
  childSeedSalt?: string | null;
  childPackedTraits?: string | null;
  claimId?: number | null;
  currentBackingProvider?: string | null;
  currentBackingKittyId?: number | null;
  currentBackingSide?: number | null;
  queuedBackingProvider?: string | null;
  queuedBackingKittyId?: number | null;
  queuedBackingSide?: number | null;
  backingQueued?: boolean | null;
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function breedingStatusFromValue(value: number): BreedingPoolStatus {
  if (value === 0) return "OPEN";
  if (value === 1) return "CYCLING";
  return "CANCELLED";
}

function nowMs(): number {
  return Date.now();
}

function isZeroAddress(address: string): boolean {
  return normalizeAddress(address) === ZERO_ADDRESS;
}

function decimalMaxZero(value: bigint): string {
  return (value > 0n ? value : 0n).toString();
}

function isMissingTokenBalanceSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /token_balances|token_balance_state|no such table/i.test(message);
}

function isMissingSyncStatusSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /sync_status|no such table/i.test(message);
}

function isMissingSyncSnapshotSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /sync_snapshot|no such table/i.test(message);
}

function isMissingRepairJobsSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /repair_jobs|no such table/i.test(message);
}

function toSearchText(generated: GeneratedKPEG): string {
  return [
    generated.traits.background,
    generated.traits.breed,
    generated.traits.clothes,
    generated.traits.mood,
    generated.traits.marks,
    generated.traits.mouth,
    generated.traits.eyes,
    generated.traits.accessory,
  ]
    .join(" ")
    .toLowerCase();
}

function toRarityScore(kpegRarityOneInN: number): number {
  if (!Number.isFinite(kpegRarityOneInN) || kpegRarityOneInN <= 0) {
    return 0;
  }
  return Math.log10(kpegRarityOneInN) * 100;
}

function weightedChance<T extends string>(trait: T, weights: Record<T, number>, allowed?: readonly T[]) {
  const selectedWeight = weights[trait] ?? 0;
  const entries = Object.entries(weights) as Array<[T, number]>;
  let contextTotalWeight = 0;
  for (const [key, value] of entries) {
    if (allowed && !allowed.includes(key)) {
      continue;
    }
    contextTotalWeight += value;
  }
  return {
    trait,
    selectedWeight,
    contextTotalWeight,
    probabilityPct:
      contextTotalWeight > 0 && selectedWeight > 0
        ? (selectedWeight / contextTotalWeight) * 100
        : 0
  };
}

function onchainDisplayOdds(traits: GeneratedKPEG["traits"], tier: Tier): TraitOdds {
  const accessoryAllowed = ACCESSORIES.filter((item) => isAccessoryAllowed(traits.clothes, item, traits.breed));
  const backgroundAllowed = BACKGROUNDS.filter((item) => isBackgroundAllowedForBreed(traits.breed, item));
  const moodAllowed = MOODS.filter((item) => isMoodAllowed(item, traits.mouth, traits.background));
  const markAllowed = MARKS.filter((item) => isMarkAllowed(traits.clothes, item, traits.breed));

  return {
    background: weightedChance(traits.background, BACKGROUND_WEIGHTS_BY_TIER[tier], backgroundAllowed),
    breed: weightedChance(traits.breed, BREED_WEIGHTS_BY_TIER[tier]),
    clothes: weightedChance(traits.clothes, CLOTHES_WEIGHTS_BY_TIER[tier]),
    mood: weightedChance(traits.mood, MOOD_WEIGHTS_BY_TIER[tier], moodAllowed),
    marks: weightedChance(traits.marks, MARKS_WEIGHTS_BY_TIER[tier], markAllowed),
    mouth: weightedChance(traits.mouth, MOUTH_WEIGHTS_BY_TIER[tier]),
    eyes: weightedChance(traits.eyes, EYES_WEIGHTS_BY_TIER[tier]),
    accessory: weightedChance(traits.accessory, ACCESSORY_WEIGHTS_BY_TIER[tier], accessoryAllowed)
  };
}

function withOnchainDisplayOdds(generated: GeneratedKPEG, traits: GeneratedKPEG["traits"]): GeneratedKPEG {
  const traitOdds = onchainDisplayOdds(traits, generated.tier);
  const globalRarity = computeGlobalRarity({ traits, mintTier: generated.tier });
  return {
    ...generated,
    traits,
    traitOdds,
    kpegTier: globalRarity.tier,
    kpegTierLabel: globalRarity.tierLabel,
    kpegRarityPct: globalRarity.percentage,
    kpegRarityOneInN: globalRarity.oneInN,
    kpegRarityBasis: "Rarity Probability"
  };
}

function toKittyListDto(row: KittyRow) {
  const traits = JSON.parse(row.traits_json) as GeneratedKPEG["traits"];
  const fallbackRarity = computeGlobalRarity({ traits, mintTier: row.tier as Tier });
  const rarityPct = Number.isFinite(row.kpeg_rarity_pct)
    ? row.kpeg_rarity_pct
    : fallbackRarity.percentage;
  const rarityOneInN = Number.isFinite(row.kpeg_rarity_one_in_n)
    ? row.kpeg_rarity_one_in_n
    : fallbackRarity.oneInN;
  const rarityScore = Number.isFinite(row.rarity_score)
    ? row.rarity_score
    : toRarityScore(rarityOneInN);
  const rarityTier = kpegTierFromRarityPct(rarityPct);
  return {
    id: row.id,
    seed: row.seed,
    tier: rarityTier,
    tierLabel: TIER_LABELS[rarityTier],
    mintTier: row.tier as Tier,
    mintTierLabel: row.tier_label,
    owner: row.owner,
    mintedBy: row.minted_by,
    mintBatchSize: row.mint_batch_size,
    mintedAt: row.created_at,
    blockNumber: row.block_number,
    rarityScore,
    traits,
    kpegRarity: {
      label: "RARITY",
      percentage: rarityPct,
      oneInN: rarityOneInN,
      basis: "Rarity Probability"
    }
  };
}

function toKittyDto(row: KittyRow) {
  const traitOdds = JSON.parse(row.trait_odds_json) as GeneratedKPEG["traitOdds"];
  return {
    ...toKittyListDto(row),
    txHash: row.tx_hash,
    gasUsed: row.gas_used,
    baseFeeWei: row.base_fee_wei,
    traitOdds
  };
}

function toBornDto(row: BornLineageRow | null | undefined) {
  if (!row) {
    return {
      way: "BUY" as const,
      parentIds: [] as number[]
    };
  }
  const parentIds: number[] = [];
  if (row.parent_a_kitty_id !== null) {
    parentIds.push(row.parent_a_kitty_id);
  }
  if (row.parent_b_kitty_id !== null) {
    parentIds.push(row.parent_b_kitty_id);
  }
  return {
    way: row.source,
    parentIds
  };
}

function onchainKittyDto(input: {
  id: number;
  owner: string;
  seed: string;
  tier: Tier;
  entropy: bigint;
}) {
  const owner = normalizeAddress(input.owner);
  const generated = generateKPEGFromOnchainEntropy({
    seed: input.seed,
    tier: input.tier,
    entropy: input.entropy
  });
  return {
    id: input.id,
    seed: input.seed,
    tier: generated.kpegTier,
    tierLabel: TIER_LABELS[generated.kpegTier],
    mintTier: generated.mintTier,
    mintTierLabel: TIER_LABELS[generated.mintTier],
    owner,
    mintedBy: owner,
    mintBatchSize: 1,
    mintedAt: 0,
    blockNumber: 0,
    txHash: `0x${"0".repeat(64)}`,
    gasUsed: null,
    baseFeeWei: null,
    rarityScore: toRarityScore(generated.kpegRarityOneInN),
    traits: generated.traits,
    traitOdds: generated.traitOdds,
    kpegRarity: {
      label: "RARITY",
      percentage: generated.kpegRarityPct,
      oneInN: generated.kpegRarityOneInN,
      basis: "Rarity Probability"
    },
    born: {
      way: "BUY" as const,
      parentIds: []
    },
    breeding: null
  };
}

function toMarketDto(
  row: MarketListingRow,
  kitties: Array<ReturnType<typeof toKittyListDto> | ReturnType<typeof toKittyDto>>
) {
  return {
    tradeId: row.trade_id,
    escrowAddress: row.escrow_address,
    seller: row.seller,
    buyer: row.buyer,
    paymentToken: row.payment_token,
    priceWei: row.price_wei,
    feeBps: row.fee_bps,
    kittyIds: JSON.parse(row.kitty_ids_json) as number[],
    kittyCount: row.kitty_count,
    status: row.status,
    createdBlock: row.created_block,
    createdTxHash: row.created_tx_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedBlock: row.closed_block,
    closedTxHash: row.closed_tx_hash,
    closedAt: row.closed_at,
    kitties
  };
}

export class KPEGRepository {
  private marketAddressCache: string | null | undefined = undefined;

  constructor(private readonly db: DbAdapter) {}

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  private async marketAddress(): Promise<string | null> {
    if (this.marketAddressCache !== undefined) {
      return this.marketAddressCache;
    }
    const row = await this.db.get<{ market_address: string | null }>(
      `SELECT market_address FROM indexer_identity WHERE id = 1`
    );
    this.marketAddressCache = row?.market_address
      ? normalizeAddress(row.market_address)
      : null;
    return this.marketAddressCache;
  }

  private isCountedHolder(owner: string, marketAddress: string | null): boolean {
    if (isZeroAddress(owner)) {
      return false;
    }
    return !marketAddress || owner !== marketAddress;
  }

  private async readOwnerAggregate(ownerInput: string): Promise<OwnerAggregateRow> {
    const owner = normalizeAddress(ownerInput);
    const row = await this.db.get<OwnerAggregateRow>(
      `SELECT owner, current_kitties, ever_kitties FROM owner_stats WHERE owner = ?`,
      [owner]
    );
    return {
      owner,
      current_kitties: Number(row?.current_kitties ?? 0),
      ever_kitties: Number(row?.ever_kitties ?? 0)
    };
  }

  private async recomputeOwnerAggregate(ownerInput: string): Promise<{
    before: OwnerAggregateRow;
    after: OwnerAggregateRow;
  }> {
    const owner = normalizeAddress(ownerInput);
    const before = await this.readOwnerAggregate(owner);
    const summary = await this.db.get<{ current_kitties: number; ever_kitties: number }>(
      `SELECT
        (SELECT COUNT(*) FROM kitties WHERE burned_at IS NULL AND owner = ?) AS current_kitties,
        (SELECT COUNT(*) FROM owner_kitty_history WHERE owner = ?) AS ever_kitties`,
      [owner, owner]
    );
    const current = Number(summary?.current_kitties ?? 0);
    const ever = Math.max(Number(summary?.ever_kitties ?? 0), current);
    await this.db.run(
      `INSERT INTO owner_stats (owner, current_kitties, ever_kitties)
       VALUES (?, ?, ?)
       ON CONFLICT(owner) DO UPDATE SET
         current_kitties = excluded.current_kitties,
         ever_kitties = excluded.ever_kitties`,
      [owner, current, ever]
    );
    return {
      before,
      after: {
        owner,
        current_kitties: current,
        ever_kitties: ever
      }
    };
  }

  private async syncOwnerAggregates(owners: Iterable<string>): Promise<{
    holdersLiveDelta: number;
    holdersEverDelta: number;
  }> {
    const marketAddress = await this.marketAddress();
    const uniqueOwners = new Set(
      [...owners]
        .map((owner) => normalizeAddress(owner))
        .filter((owner) => !isZeroAddress(owner))
    );
    if (uniqueOwners.size === 0) {
      return { holdersLiveDelta: 0, holdersEverDelta: 0 };
    }

    let holdersLiveDelta = 0;
    let holdersEverDelta = 0;
    for (const owner of uniqueOwners) {
      const { before, after } = await this.recomputeOwnerAggregate(owner);
      const beforeLive = this.isCountedHolder(owner, marketAddress) && before.current_kitties > 0;
      const afterLive = this.isCountedHolder(owner, marketAddress) && after.current_kitties > 0;
      const beforeEver = this.isCountedHolder(owner, marketAddress) && before.ever_kitties > 0;
      const afterEver = this.isCountedHolder(owner, marketAddress) && after.ever_kitties > 0;
      if (beforeLive !== afterLive) {
        holdersLiveDelta += afterLive ? 1 : -1;
      }
      if (beforeEver !== afterEver) {
        holdersEverDelta += afterEver ? 1 : -1;
      }
    }
    return { holdersLiveDelta, holdersEverDelta };
  }

  private async applyGlobalStatsDelta(input: {
    kittiesLiveDelta?: number;
    kittiesEverMintedDelta?: number;
    holdersLiveDelta?: number;
    holdersEverDelta?: number;
  }): Promise<void> {
    const kittiesLiveDelta = input.kittiesLiveDelta ?? 0;
    const kittiesEverMintedDelta = input.kittiesEverMintedDelta ?? 0;
    const holdersLiveDelta = input.holdersLiveDelta ?? 0;
    const holdersEverDelta = input.holdersEverDelta ?? 0;
    if (
      kittiesLiveDelta === 0 &&
      kittiesEverMintedDelta === 0 &&
      holdersLiveDelta === 0 &&
      holdersEverDelta === 0
    ) {
      return;
    }
    await this.db.run(
      `UPDATE global_stats
       SET
         kitties_live = MAX(0, kitties_live + ?),
         kitties_ever_minted = MAX(0, kitties_ever_minted + ?)
       WHERE id = 1`,
      [kittiesLiveDelta, kittiesEverMintedDelta]
    );
  }

  private async resetAggregates(): Promise<void> {
    await this.db.run(`DELETE FROM owner_stats`);
    await this.db.run(
      `UPDATE global_stats
       SET kitties_live = 0, kitties_ever_minted = 0, holders_live = 0, holders_ever = 0
       WHERE id = 1`
    );
    await this.db.run(
      `INSERT INTO market_stats (id, volume_wei, updated_at)
     VALUES (1, '0', ?)
     ON CONFLICT(id) DO UPDATE SET
      volume_wei = excluded.volume_wei,
      updated_at = excluded.updated_at`,
      [nowMs()]
    );
    try {
      await this.db.run(
        `INSERT INTO sync_snapshot (
           id,
           head_block,
           onchain_kitties_live,
           onchain_kitties_ever_minted,
           updated_at_ms
         )
         VALUES (1, NULL, NULL, NULL, ?)
         ON CONFLICT(id) DO UPDATE SET
           head_block = NULL,
           onchain_kitties_live = NULL,
           onchain_kitties_ever_minted = NULL,
           updated_at_ms = excluded.updated_at_ms`,
        [nowMs()]
      );
    } catch (error) {
      if (!isMissingSyncSnapshotSchemaError(error)) {
        throw error;
      }
    }
  }

  async tryAcquireSyncLock(owner: string, lockedUntilMs: number, now = nowMs()): Promise<boolean> {
    const result = await this.db.run(
      `INSERT INTO sync_locks (id, owner, locked_until_ms, updated_at_ms)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        owner = excluded.owner,
        locked_until_ms = excluded.locked_until_ms,
        updated_at_ms = excluded.updated_at_ms
       WHERE sync_locks.locked_until_ms <= ?`,
      [owner, lockedUntilMs, now, now]
    );
    return (result.rowsAffected ?? 0) > 0;
  }

  async releaseSyncLock(owner: string): Promise<void> {
    await this.db.run(
      `UPDATE sync_locks
       SET locked_until_ms = 0, updated_at_ms = ?
       WHERE id = 1 AND owner = ?`,
      [nowMs(), owner]
    );
  }

  async getChainIdentity(): Promise<{
    chainId: number;
    tokenAddress: string;
    marketAddress: string | null;
  } | null> {
    const current = await this.db.get<{ chain_id: number; token_address: string; market_address: string | null }>(
      `SELECT chain_id, token_address, market_address FROM indexer_identity WHERE id = 1`
    );
    if (!current) {
      return null;
    }
    return {
      chainId: Number(current.chain_id),
      tokenAddress: normalizeAddress(current.token_address),
      marketAddress: current.market_address ? normalizeAddress(current.market_address) : null
    };
  }

  private async clearIndexedStateForReplay(): Promise<void> {
    await this.db.run(`DELETE FROM kitties`);
    await this.db.run(`DELETE FROM mint_batches`);
    await this.db.run(`DELETE FROM owner_kitty_history`);
    await this.db.run(`DELETE FROM born_lineage`);
    await this.db.run(`DELETE FROM breeding_pools`);
    await this.db.run(`DELETE FROM breeding_claims`);
    await this.db.run(`DELETE FROM breeding_events`);
    await this.db.run(`DELETE FROM market_listings`);
    await this.db.run(`DELETE FROM market_sales`);
    await this.db.run(`DELETE FROM token_balances`);
    await this.resetAggregates();
    await this.setLatestIndexedBlock(0);
    await this.setLatestTokenBalanceIndexedBlock(0);
    await this.db.run(
      `INSERT INTO sync_status (
         id,
         last_sync_success_at_ms,
         last_sync_failed_at_ms,
         last_sync_phase,
         last_sync_from_block,
         last_sync_to_block,
         last_sync_event_kind,
         last_sync_tx_hash,
         last_sync_log_index,
         last_sync_error
       )
       VALUES (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
       ON CONFLICT(id) DO UPDATE SET
         last_sync_success_at_ms = NULL,
         last_sync_failed_at_ms = NULL,
         last_sync_phase = NULL,
         last_sync_from_block = NULL,
         last_sync_to_block = NULL,
         last_sync_event_kind = NULL,
         last_sync_tx_hash = NULL,
         last_sync_log_index = NULL,
         last_sync_error = NULL`
    );
  }

  async resetIndexedStateForReplay(): Promise<void> {
    await this.db.transaction(async () => {
      await this.clearIndexedStateForReplay();
    });
  }

  async ensureChainIdentity(input: ChainIdentityInput): Promise<{ reset: boolean }> {
    const tokenAddress = normalizeAddress(input.tokenAddress);
    const marketAddress = input.marketAddress ? normalizeAddress(input.marketAddress) : null;
    const current = await this.getChainIdentity();

    if (
      current &&
      current.chainId === input.chainId &&
      current.tokenAddress === tokenAddress &&
      String(current.marketAddress ?? "") === String(marketAddress ?? "")
    ) {
      this.marketAddressCache = marketAddress;
      return { reset: false };
    }

    await this.db.transaction(async () => {
      if (current) {
        await this.clearIndexedStateForReplay();
      }
      await this.db.run(
        `INSERT INTO indexer_identity (id, chain_id, token_address, market_address)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          chain_id = excluded.chain_id,
          token_address = excluded.token_address,
          market_address = excluded.market_address`,
        [input.chainId, tokenAddress, marketAddress]
      );
    });
    this.marketAddressCache = marketAddress;

    return { reset: Boolean(current) };
  }

  private async rememberOwner(ownerInput: string, kittyId: number, firstSeenAt: number): Promise<void> {
    const owner = normalizeAddress(ownerInput);
    if (isZeroAddress(owner)) {
      return;
    }
    await this.db.run(
      `INSERT OR IGNORE INTO owner_kitty_history (owner, kitty_id, first_seen_at) VALUES (?, ?, ?)`,
      [owner, kittyId, firstSeenAt]
    );
  }

  async mintKitties(input: MintInput): Promise<{ mintedIds: number[] }> {
    const owner = normalizeAddress(input.owner);
    const wholeBought = Math.floor(input.wholeBought);
    if (wholeBought < 1) {
      throw new Error("wholeBought must be >= 1");
    }

    const createdAt = nowMs();
    const blockNumber = input.blockNumber ?? ((await this.latestIndexedBlock()) + 1);
    const txHash = `0xmint${createdAt.toString(16)}${Math.random().toString(16).slice(2, 10)}`;

    const startId = (await this.everMintedKitties()) + 1;
    const mintedIds: number[] = [];

    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT INTO mint_batches (owner, whole_bought, minted_count, created_at)
         VALUES (?, ?, ?, ?)`,
        [owner, wholeBought, wholeBought, createdAt]
      );
      for (let i = 0; i < wholeBought; i += 1) {
        const kittyId = startId + i;
        const generated = generateKPEG({
          wholeBought,
          walletAddress: owner,
          mintNonce: kittyId,
          seedHint: `${createdAt}:${i}`
        });

        await this.db.run(
          `INSERT INTO kitties (
            id, seed, tier, tier_label, owner, minted_by, mint_batch_size, created_at, updated_at,
            block_number, tx_hash, gas_used, base_fee_wei, burned_at, rarity_score, kpeg_rarity_pct, kpeg_rarity_one_in_n,
            traits_json, trait_odds_json, search_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
          [
            kittyId,
            generated.seed,
            generated.tier,
            generated.tierLabel,
            owner,
            owner,
            wholeBought,
            createdAt,
            createdAt,
            blockNumber,
            txHash,
            toRarityScore(generated.kpegRarityOneInN),
            generated.kpegRarityPct,
            generated.kpegRarityOneInN,
            JSON.stringify(generated.traits),
            JSON.stringify(generated.traitOdds),
            toSearchText(generated)
          ]
        );
        await this.db.run(
          `INSERT INTO born_lineage (child_kitty_id, source, parent_a_kitty_id, parent_b_kitty_id, created_at)
           VALUES (?, 'BUY', NULL, NULL, ?)
           ON CONFLICT(child_kitty_id) DO NOTHING`,
          [kittyId, createdAt]
        );
        await this.rememberOwner(owner, kittyId, createdAt);
        mintedIds.push(kittyId);
      }
      const { holdersLiveDelta, holdersEverDelta } = await this.syncOwnerAggregates([owner]);
      await this.applyGlobalStatsDelta({
        kittiesLiveDelta: wholeBought,
        kittiesEverMintedDelta: wholeBought,
        holdersLiveDelta,
        holdersEverDelta
      });
      await this.setLatestIndexedBlock(blockNumber);
    });

    return { mintedIds };
  }

  async ingestMintEvent(input: ChainMintEventInput): Promise<void> {
    await this.ingestMintEvents([input]);
  }

  async ingestMintEvents(inputs: ChainMintEventInput[]): Promise<void> {
    if (inputs.length === 0) {
      return;
    }

    const chunkSize = 50;
    for (let start = 0; start < inputs.length; start += chunkSize) {
      const chunk = inputs.slice(start, start + chunkSize);
      const kittyRows: Array<string | number | null> = [];
      const historyRows: Array<string | number> = [];
      const kittyPlaceholders: string[] = [];
      const historyPlaceholders: string[] = [];
      const lineageRows: Array<number | string> = [];
      const lineagePlaceholders: string[] = [];

      for (const input of chunk) {
        const owner = normalizeAddress(input.owner);
        const mintedBy = normalizeAddress(input.mintedBy);
        const generatedBase = generateKPEGFromSeed({
          seed: input.seed,
          tier: input.tier
        });
        const generated: GeneratedKPEG = input.traits ? withOnchainDisplayOdds(generatedBase, input.traits) : generatedBase;
        const createdAt = input.mintedAt ?? nowMs();
        kittyPlaceholders.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)");
        kittyRows.push(
          input.kittyId,
          input.seed,
          generated.tier,
          generated.tierLabel,
          owner,
          mintedBy,
          input.batchSizeWhole,
          createdAt,
          createdAt,
          input.blockNumber,
          input.txHash,
          input.gasUsed ?? null,
          input.baseFeeWei ?? null,
          toRarityScore(generated.kpegRarityOneInN),
          generated.kpegRarityPct,
          generated.kpegRarityOneInN,
          JSON.stringify(generated.traits),
          JSON.stringify(generated.traitOdds),
          toSearchText(generated)
        );
        lineagePlaceholders.push("(?, 'BUY', NULL, NULL, ?)");
        lineageRows.push(input.kittyId, createdAt);

        for (const historyOwner of new Set([owner, mintedBy])) {
          if (isZeroAddress(historyOwner)) {
            continue;
          }
          historyPlaceholders.push("(?, ?, ?)");
          historyRows.push(historyOwner, input.kittyId, createdAt);
        }
      }

      const chunkKittyIds = chunk.map((input) => input.kittyId);
      const existingById = new Map<number, { owner: string; burned_at: number | null }>();
      if (chunkKittyIds.length > 0) {
        const placeholders = chunkKittyIds.map(() => "?").join(", ");
        const existingRows = await this.db.all<{ id: number; owner: string; burned_at: number | null }>(
          `SELECT id, owner, burned_at FROM kitties WHERE id IN (${placeholders})`,
          chunkKittyIds
        );
        for (const row of existingRows) {
          existingById.set(row.id, row);
        }
      }
      let kittiesLiveDelta = 0;
      let kittiesEverMintedDelta = 0;
      const affectedOwners = new Set<string>();
      for (const input of chunk) {
        affectedOwners.add(normalizeAddress(input.owner));
        affectedOwners.add(normalizeAddress(input.mintedBy));
        const existing = existingById.get(input.kittyId);
        if (!existing) {
          kittiesLiveDelta += 1;
          kittiesEverMintedDelta += 1;
          continue;
        }
        affectedOwners.add(normalizeAddress(existing.owner));
        if (existing.burned_at !== null) {
          kittiesLiveDelta += 1;
        }
      }

      await this.db.transaction(async () => {
        await this.db.run(
          `INSERT INTO kitties (
            id, seed, tier, tier_label, owner, minted_by, mint_batch_size, created_at, updated_at,
            block_number, tx_hash, gas_used, base_fee_wei, burned_at, rarity_score, kpeg_rarity_pct, kpeg_rarity_one_in_n,
            traits_json, trait_odds_json, search_text
          ) VALUES ${kittyPlaceholders.join(", ")}
          ON CONFLICT(id) DO UPDATE SET
            owner=excluded.owner,
            updated_at=excluded.updated_at,
            block_number=excluded.block_number,
            gas_used=excluded.gas_used,
            base_fee_wei=excluded.base_fee_wei,
            burned_at=NULL`,
          kittyRows
        );
        if (historyRows.length > 0) {
          await this.db.run(
            `INSERT OR IGNORE INTO owner_kitty_history (owner, kitty_id, first_seen_at)
             VALUES ${historyPlaceholders.join(", ")}`,
            historyRows
          );
        }
        if (lineageRows.length > 0) {
          await this.db.run(
            `INSERT INTO born_lineage (child_kitty_id, source, parent_a_kitty_id, parent_b_kitty_id, created_at)
             VALUES ${lineagePlaceholders.join(", ")}
             ON CONFLICT(child_kitty_id) DO NOTHING`,
            lineageRows
          );
        }
        const { holdersLiveDelta, holdersEverDelta } = await this.syncOwnerAggregates(affectedOwners);
        await this.applyGlobalStatsDelta({
          kittiesLiveDelta,
          kittiesEverMintedDelta,
          holdersLiveDelta,
          holdersEverDelta
        });
      });
    }
  }

  async applyBornMintTraits(input: BornMintTraitsOverrideInput): Promise<void> {
    const kitty = await this.db.get<{ id: number; seed: string; tier: number; burned_at: number | null }>(
      `SELECT id, seed, tier, burned_at FROM kitties WHERE id = ?`,
      [input.kittyId]
    );
    if (!kitty || kitty.burned_at !== null) {
      return;
    }
    const tier = kitty.tier < 0 ? 0 : kitty.tier > 4 ? 4 : (kitty.tier as Tier);
    const generatedBase = generateKPEGFromSeed({
      seed: kitty.seed as `0x${string}`,
      tier
    });
    const generated = withOnchainDisplayOdds(generatedBase, input.traits);
    const updatedAt = input.updatedAt ?? nowMs();
    await this.db.run(
      `UPDATE kitties
       SET tier = ?,
           tier_label = ?,
           rarity_score = ?,
           kpeg_rarity_pct = ?,
           kpeg_rarity_one_in_n = ?,
           traits_json = ?,
           trait_odds_json = ?,
           search_text = ?,
           updated_at = ?,
           block_number = ?,
           tx_hash = ?,
           burned_at = NULL
       WHERE id = ?`,
      [
        generated.tier,
        generated.tierLabel,
        toRarityScore(generated.kpegRarityOneInN),
        generated.kpegRarityPct,
        generated.kpegRarityOneInN,
        JSON.stringify(generated.traits),
        JSON.stringify(generated.traitOdds),
        toSearchText(generated),
        updatedAt,
        input.blockNumber,
        input.txHash,
        input.kittyId
      ]
    );
  }

  async ingestBurnEvent(input: ChainBurnEventInput): Promise<void> {
    const row = await this.db.get<{ owner: string; burned_at: number | null }>(
      `SELECT owner, burned_at FROM kitties WHERE id = ?`,
      [input.kittyId]
    );
    const owner = row?.owner ? normalizeAddress(row.owner) : null;
    const wasLive = Boolean(row && row.burned_at === null);
    await this.db.transaction(async () => {
      await this.db.run(
        `UPDATE kitties SET burned_at = ?, updated_at = ?, block_number = ?, owner = ? WHERE id = ?`,
        [nowMs(), nowMs(), input.blockNumber, ZERO_ADDRESS, input.kittyId]
      );
      if (owner && wasLive) {
        const { holdersLiveDelta, holdersEverDelta } = await this.syncOwnerAggregates([owner]);
        await this.applyGlobalStatsDelta({
          kittiesLiveDelta: -1,
          holdersLiveDelta,
          holdersEverDelta
        });
      }
    });
  }

  async ingestBurnRange(input: { startKittyId: number; count: number; owner: string; blockNumber: number }): Promise<void> {
    if (input.count <= 0) {
      return;
    }
    const owner = normalizeAddress(input.owner);
    const burnOwners = await this.db.all<{ owner: string; value: number }>(
      `SELECT owner, COUNT(*) AS value
       FROM kitties
       WHERE id >= ? AND id < ? AND burned_at IS NULL
       GROUP BY owner`,
      [input.startKittyId, input.startKittyId + input.count]
    );
    const burnedCount = burnOwners.reduce((sum, row) => sum + Number(row.value ?? 0), 0);
    await this.db.transaction(async () => {
      await this.db.run(
        `UPDATE kitties
         SET burned_at = ?, updated_at = ?, block_number = ?, owner = ?
         WHERE id >= ? AND id < ?`,
        [
          nowMs(),
          nowMs(),
          input.blockNumber,
          ZERO_ADDRESS,
          input.startKittyId,
          input.startKittyId + input.count
        ]
      );
      const affectedOwners = new Set<string>([owner]);
      for (const row of burnOwners) {
        affectedOwners.add(normalizeAddress(row.owner));
      }
      const { holdersLiveDelta, holdersEverDelta } = await this.syncOwnerAggregates(affectedOwners);
      await this.applyGlobalStatsDelta({
        kittiesLiveDelta: -burnedCount,
        holdersLiveDelta,
        holdersEverDelta
      });
    });
  }

  async ingestMoveEvent(input: ChainMoveEventInput): Promise<void> {
    const from = normalizeAddress(input.from);
    const to = normalizeAddress(input.to);
    const previous = await this.db.get<{ owner: string }>(
      `SELECT owner FROM kitties WHERE id = ? AND burned_at IS NULL`,
      [input.kittyId]
    );
    if (!previous) {
      return;
    }
    await this.db.transaction(async () => {
      await this.db.run(
        `UPDATE kitties SET owner = ?, updated_at = ?, block_number = ? WHERE id = ? AND burned_at IS NULL`,
        [to, nowMs(), input.blockNumber, input.kittyId]
      );
      await this.rememberOwner(to, input.kittyId, nowMs());
      const { holdersLiveDelta, holdersEverDelta } = await this.syncOwnerAggregates([
        from,
        to,
        normalizeAddress(previous.owner)
      ]);
      await this.applyGlobalStatsDelta({
        holdersLiveDelta,
        holdersEverDelta
      });
    });
  }

  async ingestMoveRange(input: {
    startKittyId: number;
    count: number;
    from: string;
    to: string;
    blockNumber: number;
  }): Promise<void> {
    if (input.count <= 0) {
      return;
    }
    const from = normalizeAddress(input.from);
    const to = normalizeAddress(input.to);
    const updatedAt = nowMs();
    const movedRows = await this.db.all<{ id: number; owner: string }>(
      `SELECT id, owner
       FROM kitties
       WHERE id >= ? AND id < ? AND burned_at IS NULL`,
      [input.startKittyId, input.startKittyId + input.count]
    );
    if (movedRows.length === 0) {
      return;
    }

    await this.db.transaction(async () => {
      await this.db.run(
        `UPDATE kitties
         SET owner = ?, updated_at = ?, block_number = ?
         WHERE id >= ? AND id < ? AND burned_at IS NULL`,
        [to, updatedAt, input.blockNumber, input.startKittyId, input.startKittyId + input.count]
      );
      const affectedOwners = new Set([from, to]);
      for (const row of movedRows) {
        affectedOwners.add(normalizeAddress(row.owner));
      }
      if (isZeroAddress(to)) {
        const { holdersLiveDelta, holdersEverDelta } = await this.syncOwnerAggregates(affectedOwners);
        await this.applyGlobalStatsDelta({
          holdersLiveDelta,
          holdersEverDelta
        });
        return;
      }

      const chunkSize = 200;
      for (let start = 0; start < movedRows.length; start += chunkSize) {
        const movedChunk = movedRows.slice(start, start + chunkSize);
        const placeholders: string[] = [];
        const historyRows: Array<string | number> = [];
        for (const row of movedChunk) {
          placeholders.push("(?, ?, ?)");
          historyRows.push(to, row.id, updatedAt);
        }
        await this.db.run(
          `INSERT OR IGNORE INTO owner_kitty_history (owner, kitty_id, first_seen_at)
           VALUES ${placeholders.join(", ")}`,
          historyRows
        );
      }
      const { holdersLiveDelta, holdersEverDelta } = await this.syncOwnerAggregates(affectedOwners);
      await this.applyGlobalStatsDelta({
        holdersLiveDelta,
        holdersEverDelta
      });
    });
  }

  async ingestBornLineage(input: BornLineageInput): Promise<void> {
    const createdAt = input.createdAt ?? nowMs();
    await this.db.run(
      `INSERT INTO born_lineage (child_kitty_id, source, parent_a_kitty_id, parent_b_kitty_id, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(child_kitty_id) DO UPDATE SET
         source = excluded.source,
         parent_a_kitty_id = excluded.parent_a_kitty_id,
         parent_b_kitty_id = excluded.parent_b_kitty_id,
         created_at = excluded.created_at`,
      [
        input.childKittyId,
        input.source,
        input.parentAKittyId ?? null,
        input.parentBKittyId ?? null,
        createdAt
      ]
    );
  }

  async ingestBreedingEvent(input: BreedingEventInput): Promise<void> {
    const createdAt = nowMs();
    const payloadJson = JSON.stringify(input.payload ?? {});
    const host = input.host ? normalizeAddress(input.host) : null;
    const joiner = input.joiner ? normalizeAddress(input.joiner) : null;
    const childOwner = input.childOwner ? normalizeAddress(input.childOwner) : null;
    const childPackedTraits =
      input.childPackedTraits === null || input.childPackedTraits === undefined
        ? null
        : String(input.childPackedTraits);
    const childSeedSalt = input.childSeedSalt ?? null;
    const nextStatus = input.nextStatus === null || input.nextStatus === undefined ? null : Number(input.nextStatus);
    const resultValue = input.result === null || input.result === undefined ? null : Number(input.result);

    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT INTO breeding_events (
          pool_id, event_kind, result, parent_a_kitty_id, parent_b_kitty_id, child_kitty_id,
          tx_hash, block_number, log_index, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tx_hash, log_index) DO NOTHING`,
        [
          input.poolId,
          input.eventKind,
          resultValue,
          input.parentAKittyId ?? null,
          input.parentBKittyId ?? null,
          input.childKittyId ?? null,
          input.txHash,
          input.blockNumber,
          input.logIndex,
          payloadJson,
          createdAt
        ]
      );

      if (input.eventKind === "POOL_CREATED") {
        const status: BreedingPoolStatus = input.poolType === 0 ? "CYCLING" : "OPEN";
        const filterCount = input.filterCount ?? 0;
        const filterGroups = JSON.stringify((input.filterGroups ?? []).slice(0, 5));
        const filterTraits = JSON.stringify((input.filterTraits ?? []).slice(0, 5));
        await this.db.run(
          `INSERT INTO breeding_pools (
            pool_id, pool_type, status, host, joiner, parent_a_kitty_id, parent_b_kitty_id,
            cycle_started_at, cycle_days, filter_count, filter_groups_json, filter_traits_json,
            current_backing_provider, current_backing_kitty_id, current_backing_side,
            queued_backing_provider, queued_backing_kitty_id, queued_backing_side,
            last_result, child_tier,
            child_kitty_id, child_owner, child_seed_salt, child_packed_traits, updated_block, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
          ON CONFLICT(pool_id) DO UPDATE SET
            pool_type = excluded.pool_type,
            status = excluded.status,
            host = excluded.host,
            joiner = excluded.joiner,
            parent_a_kitty_id = excluded.parent_a_kitty_id,
            parent_b_kitty_id = excluded.parent_b_kitty_id,
            cycle_started_at = excluded.cycle_started_at,
            cycle_days = excluded.cycle_days,
            filter_count = excluded.filter_count,
            filter_groups_json = excluded.filter_groups_json,
            filter_traits_json = excluded.filter_traits_json,
            updated_block = excluded.updated_block,
            updated_at = excluded.updated_at`,
          [
            input.poolId,
            input.poolType ?? null,
            status,
            host,
            null,
            input.parentAKittyId ?? null,
            input.parentBKittyId ?? null,
            input.cycleStartedAt ?? null,
            input.cycleDays ?? null,
            filterCount,
            filterGroups,
            filterTraits,
            input.blockNumber,
            createdAt
          ]
        );
      } else if (input.eventKind === "POOL_JOINED") {
        const status: BreedingPoolStatus =
          input.cycleStartedAt !== null && input.cycleStartedAt !== undefined && input.cycleStartedAt > 0
            ? "CYCLING"
            : "OPEN";
        await this.db.run(
          `UPDATE breeding_pools
           SET status = ?,
               joiner = ?,
               parent_b_kitty_id = ?,
               cycle_started_at = ?,
               cycle_days = ?,
               updated_block = ?,
               updated_at = ?
           WHERE pool_id = ?`,
          [
            status,
            joiner,
            input.parentBKittyId ?? null,
            input.cycleStartedAt ?? null,
            input.cycleDays ?? null,
            input.blockNumber,
            createdAt,
            input.poolId
          ]
        );
      } else if (input.eventKind === "POOL_LEFT") {
        const status = breedingStatusFromValue(nextStatus ?? 3);
        if (status === "OPEN") {
          await this.db.run(
          `UPDATE breeding_pools
             SET status = 'OPEN',
                 joiner = NULL,
                 parent_b_kitty_id = NULL,
                 cycle_started_at = NULL,
                 cycle_days = NULL,
                 updated_block = ?,
                 updated_at = ?
             WHERE pool_id = ?`,
            [input.blockNumber, createdAt, input.poolId]
          );
        } else if (status === "CANCELLED") {
          await this.db.run(
          `UPDATE breeding_pools
             SET status = 'CANCELLED',
                 joiner = NULL,
                 parent_a_kitty_id = NULL,
                 parent_b_kitty_id = NULL,
                 cycle_started_at = NULL,
                 cycle_days = NULL,
                 updated_block = ?,
                 updated_at = ?
             WHERE pool_id = ?`,
            [input.blockNumber, createdAt, input.poolId]
          );
        }
      } else if (input.eventKind === "CYCLE_RESET") {
        const status = breedingStatusFromValue(nextStatus ?? 1);
        const cycleStartedAt =
          input.cycleStartedAt === null || input.cycleStartedAt === undefined || input.cycleStartedAt === 0
            ? null
            : input.cycleStartedAt;
        const cycleDays = input.cycleDays === null || input.cycleDays === undefined ? null : input.cycleDays;
        await this.db.run(
          `UPDATE breeding_pools
           SET status = ?,
               cycle_started_at = ?,
               cycle_days = ?,
               updated_block = ?,
               updated_at = ?
           WHERE pool_id = ?`,
          [status, cycleStartedAt, cycleDays, input.blockNumber, createdAt, input.poolId]
        );
      } else if (input.eventKind === "SETTLED") {
        await this.db.run(
          `UPDATE breeding_pools
           SET last_result = ?,
               child_tier = ?,
               child_kitty_id = ?,
               child_owner = ?,
               child_seed_salt = ?,
               child_packed_traits = ?,
               updated_block = ?,
               updated_at = ?
           WHERE pool_id = ?`,
          [
            resultValue,
            input.childTier ?? null,
            input.childKittyId ?? null,
            childOwner,
            childSeedSalt,
            childPackedTraits,
            input.blockNumber,
            createdAt,
            input.poolId
          ]
        );

        if (resultValue === 0 && input.childKittyId && childOwner && input.claimId) {
          await this.db.run(
            `INSERT INTO breeding_claims (
              claim_id, pool_id, child_kitty_id, child_owner, claimed,
              created_block, created_at, claimed_block, claimed_at, claimed_tx_hash
            ) VALUES (?, ?, ?, ?, 0, ?, ?, NULL, NULL, NULL)
            ON CONFLICT(child_kitty_id) DO UPDATE SET
              claim_id = excluded.claim_id,
              pool_id = excluded.pool_id,
              child_owner = excluded.child_owner,
              created_block = excluded.created_block,
              created_at = excluded.created_at`,
            [input.claimId, input.poolId, input.childKittyId, childOwner, input.blockNumber, createdAt]
          );
        }
      } else if (input.eventKind === "BACKING_STAKED") {
        const side = input.currentBackingSide ?? null;
        const kittyId = input.currentBackingKittyId ?? null;
        if (side === null || kittyId === null) {
          // no-op when payload is incomplete
        } else if (input.backingQueued) {
          await this.db.run(
            `UPDATE breeding_pools
             SET queued_backing_provider = ?,
                 queued_backing_kitty_id = ?,
                 queued_backing_side = ?,
                 updated_block = ?,
                 updated_at = ?
             WHERE pool_id = ?`,
            [
              input.currentBackingProvider ? normalizeAddress(input.currentBackingProvider) : null,
              kittyId,
              side,
              input.blockNumber,
              createdAt,
              input.poolId
            ]
          );
        } else {
          await this.db.run(
            `UPDATE breeding_pools
             SET current_backing_provider = ?,
                 current_backing_kitty_id = ?,
                 current_backing_side = ?,
                 updated_block = ?,
                 updated_at = ?
             WHERE pool_id = ?`,
            [
              input.currentBackingProvider ? normalizeAddress(input.currentBackingProvider) : null,
              kittyId,
              side,
              input.blockNumber,
              createdAt,
              input.poolId
            ]
          );
        }
      } else if (input.eventKind === "BACKING_WITHDRAWN") {
        if (input.backingQueued) {
          await this.db.run(
            `UPDATE breeding_pools
             SET queued_backing_provider = NULL,
                 queued_backing_kitty_id = NULL,
                 queued_backing_side = NULL,
                 updated_block = ?,
                 updated_at = ?
             WHERE pool_id = ?`,
            [input.blockNumber, createdAt, input.poolId]
          );
        } else {
          await this.db.run(
            `UPDATE breeding_pools
             SET current_backing_provider = NULL,
                 current_backing_kitty_id = NULL,
                 current_backing_side = NULL,
                 updated_block = ?,
                 updated_at = ?
             WHERE pool_id = ?`,
            [input.blockNumber, createdAt, input.poolId]
          );
        }
      } else if (input.eventKind === "BACKING_CONSUMED") {
        await this.db.run(
          `UPDATE breeding_pools
           SET current_backing_provider = NULL,
               current_backing_kitty_id = NULL,
               current_backing_side = NULL,
               updated_block = ?,
               updated_at = ?
           WHERE pool_id = ?`,
          [input.blockNumber, createdAt, input.poolId]
        );
      } else if (input.eventKind === "BACKING_PROMOTED") {
        await this.db.run(
          `UPDATE breeding_pools
           SET current_backing_provider = ?,
               current_backing_kitty_id = ?,
               current_backing_side = ?,
               queued_backing_provider = NULL,
               queued_backing_kitty_id = NULL,
               queued_backing_side = NULL,
               updated_block = ?,
               updated_at = ?
           WHERE pool_id = ?`,
          [
            input.currentBackingProvider ? normalizeAddress(input.currentBackingProvider) : null,
            input.currentBackingKittyId ?? null,
            input.currentBackingSide ?? null,
            input.blockNumber,
            createdAt,
            input.poolId
          ]
        );
      } else if (input.eventKind === "LINEAGE") {
        if (input.childKittyId !== null && input.childKittyId !== undefined) {
          await this.ingestBornLineage({
            childKittyId: input.childKittyId,
            source: "BREEDING",
            parentAKittyId: input.parentAKittyId ?? null,
            parentBKittyId: input.parentBKittyId ?? null,
            createdAt
          });
        }
      } else if (input.eventKind === "CLAIMED") {
        await this.db.run(
          `INSERT INTO breeding_claims (
            claim_id, pool_id, child_kitty_id, child_owner, claimed,
            created_block, created_at, claimed_block, claimed_at, claimed_tx_hash
          ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
          ON CONFLICT(child_kitty_id) DO UPDATE SET
            claim_id = excluded.claim_id,
            pool_id = excluded.pool_id,
            child_owner = excluded.child_owner,
            claimed = 1,
            claimed_block = excluded.claimed_block,
            claimed_at = excluded.claimed_at,
            claimed_tx_hash = excluded.claimed_tx_hash`,
          [
            input.claimId ?? null,
            input.poolId,
            input.childKittyId ?? 0,
            childOwner ?? ZERO_ADDRESS,
            input.blockNumber,
            createdAt,
            input.blockNumber,
            createdAt,
            input.txHash
          ]
        );
      }
    });
  }

  async ingestMarketPositionCreated(input: MarketPositionCreatedInput): Promise<void> {
    const createdAt = input.createdAt ?? nowMs();
    await this.db.run(
      `INSERT INTO market_listings (
        trade_id, escrow_address, seller, buyer, payment_token, price_wei, fee_bps,
        kitty_ids_json, kitty_count, status, created_block, created_tx_hash, created_at, updated_at,
        closed_block, closed_tx_hash, closed_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
      ON CONFLICT(trade_id) DO UPDATE SET
        escrow_address=excluded.escrow_address,
        seller=excluded.seller,
        payment_token=excluded.payment_token,
        price_wei=excluded.price_wei,
        fee_bps=excluded.fee_bps,
        kitty_ids_json=excluded.kitty_ids_json,
        kitty_count=excluded.kitty_count,
        updated_at=excluded.updated_at`,
      [
        input.tradeId,
        normalizeAddress(input.escrowAddress),
        normalizeAddress(input.seller),
        normalizeAddress(input.paymentToken),
        input.priceWei,
        input.feeBps,
        JSON.stringify(input.kittyIds),
        input.kittyIds.length,
        "OPEN",
        input.blockNumber,
        input.txHash,
        createdAt,
        createdAt
      ]
    );
  }

  async ingestMarketPositionDeleted(input: MarketPositionDeletedInput): Promise<void> {
    const closedAt = input.closedAt ?? nowMs();
    await this.db.run(
      `UPDATE market_listings
       SET status = 'DELETED', updated_at = ?, closed_block = ?, closed_tx_hash = ?, closed_at = ?
       WHERE trade_id = ?`,
      [closedAt, input.blockNumber, input.txHash, closedAt, input.tradeId]
    );
  }

  async ingestMarketPositionBought(input: MarketPositionBoughtInput): Promise<void> {
    const soldAt = input.soldAt ?? nowMs();
    const buyer = normalizeAddress(input.buyer);
    const seller = normalizeAddress(input.seller);
    await this.db.transaction(async () => {
      const previousSale = await this.db.get<{ price_wei: string }>(
        `SELECT price_wei FROM market_sales WHERE trade_id = ?`,
        [input.tradeId]
      );
      const marketVolumeRow = await this.db.get<{ volume_wei: string }>(
        `SELECT volume_wei FROM market_stats WHERE id = 1`
      );
      const previousPriceWei = BigInt(previousSale?.price_wei ?? "0");
      const beforeVolumeWei = BigInt(marketVolumeRow?.volume_wei ?? "0");
      const priceDeltaWei = BigInt(input.priceWei) - previousPriceWei;
      const nextVolumeWei = decimalMaxZero(beforeVolumeWei + priceDeltaWei);

      await this.db.run(
        `UPDATE market_listings
         SET status = 'SOLD', buyer = ?, price_wei = ?, updated_at = ?, closed_block = ?, closed_tx_hash = ?, closed_at = ?
         WHERE trade_id = ?`,
        [buyer, input.priceWei, soldAt, input.blockNumber, input.txHash, soldAt, input.tradeId]
      );
      await this.db.run(
        `INSERT INTO market_sales (trade_id, seller, buyer, price_wei, fee_wei, sold_block, sold_tx_hash, sold_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(trade_id) DO UPDATE SET
          seller=excluded.seller,
          buyer=excluded.buyer,
          price_wei=excluded.price_wei,
          fee_wei=excluded.fee_wei,
          sold_block=excluded.sold_block,
          sold_tx_hash=excluded.sold_tx_hash,
          sold_at=excluded.sold_at`,
        [input.tradeId, seller, buyer, input.priceWei, input.feeWei, input.blockNumber, input.txHash, soldAt]
      );
      await this.db.run(
        `INSERT INTO market_stats (id, volume_wei, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          volume_wei = excluded.volume_wei,
          updated_at = excluded.updated_at`,
        [nextVolumeWei, soldAt]
      );
    });
  }

  async ingestMarketPositionParams(input: MarketPositionParamsInput): Promise<void> {
    await this.db.run(
      `UPDATE market_listings SET payment_token = ?, price_wei = ?, updated_at = ? WHERE trade_id = ? AND status != 'SOLD' AND status != 'DELETED'`,
      [normalizeAddress(input.paymentToken), input.priceWei, nowMs(), input.tradeId]
    );
  }

  private async readTokenBalanceState(address: string): Promise<{ balanceWei: bigint; everHeld: boolean }> {
    try {
      const row = await this.db.get<{ balance_wei: string; ever_held: number }>(
        `SELECT balance_wei, ever_held FROM token_balances WHERE address = ?`,
        [address]
      );
      return {
        balanceWei: BigInt(row?.balance_wei ?? "0"),
        everHeld: Number(row?.ever_held ?? 0) === 1
      };
    } catch {
      return { balanceWei: 0n, everHeld: false };
    }
  }

  async ingestTokenTransferEvents(inputs: TokenTransferEventInput[]): Promise<void> {
    const normalizedInputs = inputs
      .map((input) => ({
        from: normalizeAddress(input.from),
        to: normalizeAddress(input.to),
        amountWei: BigInt(input.amountWei),
      }))
      .filter((input) => input.amountWei > 0n);
    if (normalizedInputs.length === 0) {
      return;
    }

    const affected = new Set<string>();
    for (const input of normalizedInputs) {
      if (!isZeroAddress(input.from)) affected.add(input.from);
      if (!isZeroAddress(input.to)) affected.add(input.to);
    }
    if (affected.size === 0) {
      return;
    }

    const balances = new Map<string, bigint>();
    const beforeBalances = new Map<string, bigint>();
    const beforeEverHeld = new Map<string, boolean>();
    for (const address of affected) {
      const state = await this.readTokenBalanceState(address);
      balances.set(address, state.balanceWei);
      beforeBalances.set(address, state.balanceWei);
      beforeEverHeld.set(address, state.everHeld);
    }
    const everHeld = new Set<string>();
    for (const input of normalizedInputs) {
      if (!isZeroAddress(input.from)) {
        balances.set(input.from, (balances.get(input.from) ?? 0n) - input.amountWei);
        everHeld.add(input.from);
      }
      if (!isZeroAddress(input.to)) {
        balances.set(input.to, (balances.get(input.to) ?? 0n) + input.amountWei);
        everHeld.add(input.to);
      }
    }
    let holdersLiveDelta = 0;
    let holdersEverDelta = 0;
    for (const address of affected) {
      const beforeBalance = beforeBalances.get(address) ?? 0n;
      const afterBalance = balances.get(address) ?? 0n;
      const beforeLive = beforeBalance > 0n;
      const afterLive = afterBalance > 0n;
      if (beforeLive !== afterLive) {
        holdersLiveDelta += afterLive ? 1 : -1;
      }
      const beforeEver = beforeEverHeld.get(address) ?? false;
      const afterEver = beforeEver || everHeld.has(address);
      if (beforeEver !== afterEver) {
        holdersEverDelta += afterEver ? 1 : -1;
      }
    }

    try {
      await this.db.transaction(async () => {
        for (const address of affected) {
          await this.db.run(
            `INSERT INTO token_balances (address, balance_wei, ever_held)
             VALUES (?, ?, ?)
             ON CONFLICT(address) DO UPDATE SET
               balance_wei = excluded.balance_wei,
               ever_held = CASE
                 WHEN token_balances.ever_held = 1 OR excluded.ever_held = 1 THEN 1
                 ELSE 0
               END`,
            [
              address,
              decimalMaxZero(balances.get(address) ?? 0n),
              everHeld.has(address) ? 1 : 0
            ]
          );
        }
        if (holdersLiveDelta !== 0 || holdersEverDelta !== 0) {
          await this.db.run(
            `UPDATE global_stats
             SET holders_live = MAX(0, holders_live + ?),
                 holders_ever = MAX(0, holders_ever + ?)
             WHERE id = 1`,
            [holdersLiveDelta, holdersEverDelta]
          );
        }
      });
    } catch (error) {
      if (isMissingTokenBalanceSchemaError(error)) {
        return;
      }
      throw error;
    }
  }

  async transferKitty(input: TransferInput): Promise<{ moved: boolean }> {
    const to = normalizeAddress(input.to);
    const row = await this.db.get<KittyRow>(
      `SELECT * FROM kitties WHERE id = ? AND burned_at IS NULL`,
      [input.kittyId]
    );
    if (!row) {
      return { moved: false };
    }
    const from = normalizeAddress(row.owner);
    const updatedAt = nowMs();
    const blockNumber = input.blockNumber ?? ((await this.latestIndexedBlock()) + 1);
    await this.db.transaction(async () => {
      await this.db.run(`UPDATE kitties SET owner = ?, updated_at = ?, block_number = ? WHERE id = ?`, [
        to,
        updatedAt,
        blockNumber,
        input.kittyId
      ]);
      await this.rememberOwner(to, input.kittyId, updatedAt);
      const { holdersLiveDelta, holdersEverDelta } = await this.syncOwnerAggregates([from, to]);
      await this.applyGlobalStatsDelta({
        holdersLiveDelta,
        holdersEverDelta
      });
      await this.setLatestIndexedBlock(blockNumber);
    });
    return { moved: true };
  }

  async burnFromOwner(input: BurnInput): Promise<{ burnedIds: number[] }> {
    const owner = normalizeAddress(input.owner);
    const count = Math.floor(input.count);
    if (count < 1) {
      return { burnedIds: [] };
    }
    const toBurn = await this.db.all<{ id: number }>(
      `SELECT id FROM kitties WHERE owner = ? AND burned_at IS NULL ORDER BY id ASC LIMIT ?`,
      [owner, count]
    );
    if (toBurn.length === 0) {
      return { burnedIds: [] };
    }
    const updatedAt = nowMs();
    const blockNumber = input.blockNumber ?? ((await this.latestIndexedBlock()) + 1);
    await this.db.transaction(async () => {
      for (const row of toBurn) {
        await this.db.run(
          `UPDATE kitties SET burned_at = ?, updated_at = ?, block_number = ?, owner = ? WHERE id = ?`,
          [updatedAt, updatedAt, blockNumber, ZERO_ADDRESS, row.id]
        );
      }
      const { holdersLiveDelta, holdersEverDelta } = await this.syncOwnerAggregates([owner]);
      await this.applyGlobalStatsDelta({
        kittiesLiveDelta: -toBurn.length,
        holdersLiveDelta,
        holdersEverDelta
      });
      await this.setLatestIndexedBlock(blockNumber);
    });

    return { burnedIds: toBurn.map((row) => row.id) };
  }

  async getStats() {
    const stats = await this.db.get<GlobalStatsRow>(
      `SELECT kitties_live, kitties_ever_minted, holders_live, holders_ever FROM global_stats WHERE id = 1`
    );
    let holdersLive = Number(stats?.holders_live ?? 0);
    let holdersEver = Number(stats?.holders_ever ?? 0);
    if (!stats) {
      try {
        const live = await this.db.get<{ value: number }>(
          `SELECT COUNT(*) AS value
           FROM token_balances
           WHERE address != ?
             AND balance_wei != '0'`,
          [ZERO_ADDRESS]
        );
        const ever = await this.db.get<{ value: number }>(
          `SELECT COUNT(*) AS value
           FROM token_balances
           WHERE address != ?
             AND ever_held = 1`,
          [ZERO_ADDRESS]
        );
        holdersLive = Number(live?.value ?? 0);
        holdersEver = Number(ever?.value ?? 0);
      } catch {
        // Older read-only DBs may not have the token balance index until init-db runs.
      }
    }
    const latestIndexedBlock = await this.latestIndexedBlock();
    return {
      tokenSupplyFixed: FIXED_TOKEN_SUPPLY,
      kittiesLive: Number(stats?.kitties_live ?? 0),
      kittiesEverMinted: Number(stats?.kitties_ever_minted ?? 0),
      holdersLive,
      holdersEver,
      latestIndexedBlock
    };
  }

  async getMarketStats() {
    const floor = await this.db.get<{ price_wei: string }>(
      `SELECT price_wei FROM market_listings WHERE status = 'OPEN' ORDER BY LENGTH(price_wei) ASC, price_wei ASC LIMIT 1`
    );
    const listed = (await this.db.get<{ value: number }>(
      `SELECT COUNT(*) as value FROM market_listings WHERE status = 'OPEN'`
    )) ?? { value: 0 };
    const marketStats = await this.db.get<{ volume_wei: string }>(
      `SELECT volume_wei FROM market_stats WHERE id = 1`
    );
    return {
      floorWei: floor?.price_wei ?? "0",
      volumeWei: marketStats?.volume_wei ?? "0",
      listed: listed.value
    };
  }

  async getBreedingStats(ownerInput?: string) {
    const totals = await this.db.get<{
      total_pools: number;
      active_pools: number;
      total_claims: number;
      claimed_claims: number;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM breeding_pools) AS total_pools,
        (SELECT COUNT(*) FROM breeding_pools WHERE status IN ('OPEN', 'CYCLING')) AS active_pools,
        (SELECT COUNT(*) FROM breeding_claims) AS total_claims,
        (SELECT COUNT(*) FROM breeding_claims WHERE claimed = 1) AS claimed_claims`
    );
    const settledRows = await this.db.all<{ result: number; count: number }>(
      `SELECT result, COUNT(*) AS count
       FROM breeding_events
       WHERE event_kind = 'SETTLED' AND result IS NOT NULL
       GROUP BY result`
    );
    const settled = {
      success: 0,
      failedRoll: 0
    };
    for (const row of settledRows) {
      if (row.result === 0) settled.success = row.count;
      else if (row.result === 1) settled.failedRoll = row.count;
    }

    const base = {
      totalPools: Number(totals?.total_pools ?? 0),
      activePools: Number(totals?.active_pools ?? 0),
      totalClaims: Number(totals?.total_claims ?? 0),
      claimedClaims: Number(totals?.claimed_claims ?? 0),
      settled
    };
    if (!ownerInput) {
      return { ...base, owner: null };
    }
    const owner = normalizeAddress(ownerInput);
    const ownerRows = await this.db.get<{
      hosted: number;
      joined: number;
      children: number;
      claimed_children: number;
      unclaimed_children: number;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM breeding_pools WHERE host = ?) AS hosted,
        (SELECT COUNT(*) FROM breeding_pools WHERE joiner = ?) AS joined,
        (SELECT COUNT(*) FROM breeding_claims WHERE child_owner = ?) AS children,
        (SELECT COUNT(*) FROM breeding_claims WHERE child_owner = ? AND claimed = 1) AS claimed_children,
        (SELECT COUNT(*) FROM breeding_claims WHERE child_owner = ? AND claimed = 0) AS unclaimed_children`,
      [owner, owner, owner, owner, owner]
    );
    return {
      ...base,
      owner: {
        hostedPools: Number(ownerRows?.hosted ?? 0),
        joinedPools: Number(ownerRows?.joined ?? 0),
        children: Number(ownerRows?.children ?? 0),
        claimedChildren: Number(ownerRows?.claimed_children ?? 0),
        unclaimedChildren: Number(ownerRows?.unclaimed_children ?? 0)
      }
    };
  }

  async listBreedingPools(input: {
    page: number;
    pageSize: number;
    offset?: number;
    status?: BreedingPoolStatus | "ALL";
    owner?: string;
  }) {
    const offset = input.offset ?? input.page * input.pageSize;
    const whereParts: string[] = [];
    const params: Array<string | number> = [];
    if (input.status && input.status !== "ALL") {
      whereParts.push("status = ?");
      params.push(input.status);
    }
    if (input.owner) {
      whereParts.push("(host = ? OR joiner = ?)");
      const owner = normalizeAddress(input.owner);
      params.push(owner, owner);
    }
    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    const rows = await this.db.all<BreedingPoolRow>(
      `SELECT * FROM breeding_pools ${whereSql} ORDER BY pool_id DESC LIMIT ? OFFSET ?`,
      [...params, input.pageSize, offset]
    );
    const total = (await this.db.get<{ value: number }>(
      `SELECT COUNT(*) AS value FROM breeding_pools ${whereSql}`,
      params
    )) ?? { value: 0 };
    return {
      page: input.page,
      pageSize: input.pageSize,
      total: total.value,
      items: rows.map((row) => ({
        poolId: row.pool_id,
        poolType: row.pool_type,
        status: row.status,
        host: row.host,
        joiner: row.joiner,
        parentA: row.parent_a_kitty_id,
        parentB: row.parent_b_kitty_id,
        cycleStartedAt: row.cycle_started_at,
        cycleDays: row.cycle_days,
        filterCount: row.filter_count,
        filterGroups: row.filter_groups_json ? (JSON.parse(row.filter_groups_json) as number[]) : [],
        filterTraits: row.filter_traits_json ? (JSON.parse(row.filter_traits_json) as number[]) : [],
        currentBackingProvider: row.current_backing_provider,
        currentBackingKittyId: row.current_backing_kitty_id,
        currentBackingSide: row.current_backing_side,
        queuedBackingProvider: row.queued_backing_provider,
        queuedBackingKittyId: row.queued_backing_kitty_id,
        queuedBackingSide: row.queued_backing_side,
        lastResult: row.last_result,
        childTier: row.child_tier,
        childKittyId: row.child_kitty_id,
        childOwner: row.child_owner,
        childSeedSalt: row.child_seed_salt,
        childPackedTraits: row.child_packed_traits,
        updatedBlock: row.updated_block,
        updatedAt: row.updated_at
      }))
    };
  }

  async listBreedingClaims(ownerInput: string, page: number, pageSize: number, offset = page * pageSize) {
    const owner = normalizeAddress(ownerInput);
    const rows = await this.db.all<BreedingClaimRow>(
      `SELECT * FROM breeding_claims
       WHERE child_owner = ?
       ORDER BY created_block DESC, child_kitty_id DESC
       LIMIT ? OFFSET ?`,
      [owner, pageSize, offset]
    );
    const total = (await this.db.get<{ value: number }>(
      `SELECT COUNT(*) AS value FROM breeding_claims WHERE child_owner = ?`,
      [owner]
    )) ?? { value: 0 };
    return {
      page,
      pageSize,
      total: total.value,
      items: rows.map((row) => ({
        claimId: row.claim_id,
        poolId: row.pool_id,
        childKittyId: row.child_kitty_id,
        childOwner: row.child_owner,
        claimed: row.claimed === 1,
        createdBlock: row.created_block,
        createdAt: row.created_at,
        claimedBlock: row.claimed_block,
        claimedAt: row.claimed_at,
        claimedTxHash: row.claimed_tx_hash
      }))
    };
  }

  async listBreedingEvents(input: { poolId?: number; limit: number }) {
    const cappedLimit = Math.max(1, Math.min(200, input.limit));
    const rows = input.poolId
      ? await this.db.all<BreedingEventRow>(
          `SELECT * FROM breeding_events WHERE pool_id = ? ORDER BY block_number DESC, log_index DESC LIMIT ?`,
          [input.poolId, cappedLimit]
        )
      : await this.db.all<BreedingEventRow>(
          `SELECT * FROM breeding_events ORDER BY block_number DESC, log_index DESC LIMIT ?`,
          [cappedLimit]
        );
    return {
      items: rows.map((row) => ({
        id: row.id,
        poolId: row.pool_id,
        eventKind: row.event_kind,
        result: row.result,
        parentA: row.parent_a_kitty_id,
        parentB: row.parent_b_kitty_id,
        childKittyId: row.child_kitty_id,
        txHash: row.tx_hash,
        blockNumber: row.block_number,
        logIndex: row.log_index,
        payload: JSON.parse(row.payload_json),
        createdAt: row.created_at
      }))
    };
  }

  getConfig() {
    const naiveCombinationCount = computeNaiveCombinationCount();
    const documented = documentedFilteredCombinationCount();
    return {
      fixedTokenSupply: FIXED_TOKEN_SUPPLY,
      naiveCombinationCount,
      filteredCombinationCountByManifest: computeFilteredCombinationCountByManifest(),
      documentedFilteredCombinationCount: documented,
      compatibilityReduction: computeCompatibilityReduction(naiveCombinationCount, documented),
      searchDebounceMs: 250
    };
  }

  async getKittyById(id: number) {
    const row = await this.db.get<KittyRow>(`SELECT * FROM kitties WHERE id = ?`, [id]);
    if (!row) {
      return null;
    }
    const born = await this.db.get<BornLineageRow>(
      `SELECT child_kitty_id, source, parent_a_kitty_id, parent_b_kitty_id, created_at
       FROM born_lineage
       WHERE child_kitty_id = ?`,
      [id]
    );
    const parentPool = await this.db.get<{ pool_id: number; status: BreedingPoolStatus; pool_type: number | null }>(
      `SELECT pool_id, status, pool_type
       FROM breeding_pools
       WHERE (parent_a_kitty_id = ? OR parent_b_kitty_id = ?)
         AND status IN ('OPEN', 'CYCLING')
       ORDER BY pool_id DESC
       LIMIT 1`,
      [id, id]
    );
    const childClaim = await this.db.get<{ claim_id: number | null; pool_id: number; claimed: number }>(
      `SELECT claim_id, pool_id, claimed
       FROM breeding_claims
       WHERE child_kitty_id = ?
       ORDER BY created_block DESC
       LIMIT 1`,
      [id]
    );
    const breeding =
      parentPool
        ? {
            reserved: true,
            role: "PARENT" as const,
            poolId: parentPool.pool_id,
            status: parentPool.status,
            poolType: parentPool.pool_type,
            claimId: null
          }
        : childClaim && childClaim.claimed === 0
          ? {
              reserved: true,
              role: "CLAIMABLE_CHILD" as const,
              poolId: childClaim.pool_id,
              status: "CLAIMABLE" as const,
              poolType: null,
              claimId: childClaim.claim_id
            }
          : null;
    return {
      ...toKittyDto(row),
      born: toBornDto(born),
      breeding
    };
  }

  onchainKitty(input: {
    id: number;
    owner: string;
    seed: string;
    tier: Tier;
    entropy: bigint;
  }) {
    return onchainKittyDto(input);
  }

  async getMarketListing(tradeId: number) {
    const row = await this.db.get<MarketListingRow>(`SELECT * FROM market_listings WHERE trade_id = ?`, [tradeId]);
    if (!row) {
      return null;
    }
    const [listing] = await this.marketRowsWithKitties([row], "detail");
    return listing ?? null;
  }

  async listMarketListings(input: {
    page: number;
    pageSize: number;
    offset?: number;
    sort: SortMode;
    tab: "all" | "my-listings" | "bought" | "sold";
    owner?: string;
    search?: string;
  }) {
    const offset = input.offset ?? input.page * input.pageSize;
    const owner = input.owner ? normalizeAddress(input.owner) : "";
    let where = `status = 'OPEN'`;
    let args: Array<string | number> = [];
    if (input.tab === "my-listings") {
      where = `seller = ? AND status = 'OPEN'`;
      args = [owner];
    } else if (input.tab === "bought") {
      where = `buyer = ? AND status = 'SOLD'`;
      args = [owner];
    } else if (input.tab === "sold") {
      where = `seller = ? AND status = 'SOLD'`;
      args = [owner];
    }
    const search = input.search?.trim().toLowerCase() ?? "";
    if (search) {
      const like = `%${search}%`;
      where = `${where} AND (
        lower(CAST(trade_id AS TEXT)) LIKE ?
        OR lower(seller) LIKE ?
        OR lower(buyer) LIKE ?
        OR EXISTS (
          SELECT 1
          FROM json_each(market_listings.kitty_ids_json) listing_kitty
          JOIN kitties ON kitties.id = CAST(listing_kitty.value AS INTEGER)
          WHERE lower(CAST(kitties.id AS TEXT)) LIKE ?
             OR lower(kitties.search_text) LIKE ?
        )
      )`;
      args = [...args, like, like, like, like, like];
    }

    const orderBy =
      input.sort === "scarcity"
        ? `ORDER BY (
            SELECT COALESCE(MAX(kitties.rarity_score), 0)
            FROM json_each(market_listings.kitty_ids_json) listing_kitty
            JOIN kitties ON kitties.id = CAST(listing_kitty.value AS INTEGER)
          ) DESC, trade_id DESC`
        : input.tab === "bought" || input.tab === "sold"
          ? `ORDER BY COALESCE(closed_at, updated_at) DESC, trade_id DESC`
        : `ORDER BY trade_id DESC`;

    const rows = await this.db.all<MarketListingRow>(
      `SELECT * FROM market_listings WHERE ${where} ${orderBy} LIMIT ? OFFSET ?`,
      [...args, input.pageSize, offset]
    );
    const total = (await this.db.get<{ value: number }>(
      `SELECT COUNT(*) as value FROM market_listings WHERE ${where}`,
      args
    )) ?? { value: 0 };
    const items = await this.marketRowsWithKitties(rows);
    return { page: input.page, pageSize: input.pageSize, total: total.value, items };
  }

  async listMarketOwner(ownerInput: string) {
    const owner = normalizeAddress(ownerInput);
    const rows = await this.db.all<MarketListingRow>(
      `SELECT * FROM market_listings WHERE seller = ? OR buyer = ? ORDER BY trade_id DESC`,
      [owner, owner]
    );
    const items = await this.marketRowsWithKitties(rows);
    return { items };
  }

  async listMarketSales(page = 0, pageSize = 100) {
    const rows = await this.db.all<MarketListingRow>(
      `SELECT * FROM market_listings WHERE status = 'SOLD' ORDER BY trade_id DESC LIMIT ? OFFSET ?`,
      [pageSize, page * pageSize]
    );
    const total = (await this.db.get<{ value: number }>(
      `SELECT COUNT(*) as value FROM market_listings WHERE status = 'SOLD'`
    )) ?? { value: 0 };
    const items = await this.marketRowsWithKitties(rows);
    return { page, pageSize, total: total.value, items };
  }

  async listGlobal(page: number, pageSize: number, sort: SortMode, offset = page * pageSize) {
    const { sql, orderBy } = this.paginationSql(sort);
    const rows = await this.db.all<KittyRow>(
      `SELECT * FROM kitties WHERE burned_at IS NULL ${orderBy} LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );
    const total =
      (await this.db.get<{ kitties_live: number }>(`SELECT kitties_live FROM global_stats WHERE id = 1`)) ??
      { kitties_live: 0 };
    return { page, pageSize, total: total.kitties_live, items: rows.map(toKittyListDto), sql };
  }

  async listByOwner(ownerInput: string, page: number, pageSize: number, sort: SortMode, offset = page * pageSize) {
    const owner = normalizeAddress(ownerInput);
    const { sql, orderBy } = this.paginationSql(sort);
    const rows = await this.db.all<KittyRow>(
      `SELECT * FROM kitties WHERE burned_at IS NULL AND owner = ? ${orderBy} LIMIT ? OFFSET ?`,
      [owner, pageSize, offset]
    );
    const total =
      (await this.db.get<{ current_kitties: number }>(
        `SELECT current_kitties FROM owner_stats WHERE owner = ?`,
        [owner]
      )) ?? { current_kitties: 0 };
    return { page, pageSize, total: total.current_kitties, items: rows.map(toKittyListDto), sql };
  }

  async ownerStats(ownerInput: string) {
    const owner = normalizeAddress(ownerInput);
    const summary = await this.db.get<{ current_kitties: number; ever_kitties: number }>(
      `SELECT current_kitties, ever_kitties FROM owner_stats WHERE owner = ?`,
      [owner]
    );
    return {
      currentKitties: Number(summary?.current_kitties ?? 0),
      everKitties: Number(summary?.ever_kitties ?? 0)
    };
  }

  async search(input: {
    q: string;
    scope: "explore" | "my-collections";
    owner?: string | undefined;
    page: number;
    pageSize: number;
    offset?: number | undefined;
  }) {
    const q = input.q.trim().toLowerCase();
    const scopedOwner =
      input.scope === "my-collections" && input.owner
        ? normalizeAddress(input.owner)
        : null;
    if (!q) {
      if (input.scope === "my-collections" && input.owner) {
        return this.listByOwner(input.owner, input.page, input.pageSize, "latest", input.offset);
      }
      return this.listGlobal(input.page, input.pageSize, "latest", input.offset);
    }

    const idMatch = q.match(/^#?(\d+)$/);
    if (idMatch) {
      const row = await this.db.get<KittyRow>(
        `SELECT * FROM kitties WHERE id = ? AND burned_at IS NULL`,
        [Number(idMatch[1])]
      );
      const kitty =
        row &&
        (!scopedOwner || normalizeAddress(row.owner) === scopedOwner)
          ? toKittyListDto(row)
          : null;
      return {
        type: "kitty",
        items: kitty ? [kitty] : [],
        total: kitty ? 1 : 0
      };
    }

    if (q.startsWith("0x")) {
      if (scopedOwner && normalizeAddress(q) !== scopedOwner) {
        return {
          type: "holder",
          page: input.page,
          pageSize: input.pageSize,
          total: 0,
          items: []
        };
      }
      return {
        type: "holder",
        ...(await this.listByOwner(
          scopedOwner ?? q,
          input.page,
          input.pageSize,
          "latest",
          input.offset
        ))
      };
    }

    const where =
      input.scope === "my-collections" && input.owner
        ? `burned_at IS NULL AND owner = ? AND search_text LIKE ?`
        : `burned_at IS NULL AND search_text LIKE ?`;

    const args =
      input.scope === "my-collections" && input.owner
        ? [normalizeAddress(input.owner), `%${q}%`, input.pageSize, input.offset ?? input.page * input.pageSize]
        : [`%${q}%`, input.pageSize, input.offset ?? input.page * input.pageSize];

    const countArgs =
      input.scope === "my-collections" && input.owner
        ? [normalizeAddress(input.owner), `%${q}%`]
        : [`%${q}%`];

    const rows = await this.db.all<KittyRow>(
      `SELECT * FROM kitties WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      args
    );
    const total = (await this.db.get<{ value: number }>(
      `SELECT COUNT(*) as value FROM kitties WHERE ${where}`,
      countArgs
    )) ?? { value: 0 };

    return {
      type: "traitResults",
      page: input.page,
      pageSize: input.pageSize,
      total: total.value,
      items: rows.map(toKittyListDto)
    };
  }

  async recentActivity(limit: number) {
    const rows = await this.db.all<KittyRow>(`SELECT * FROM kitties ORDER BY updated_at DESC LIMIT ?`, [limit]);
    return rows.map((row) => ({
      kittyId: row.id,
      owner: row.owner,
      mintedBy: row.minted_by,
      updatedAt: row.updated_at,
      burnedAt: row.burned_at,
      tier: row.tier,
      rarityScore: row.rarity_score
    }));
  }

  preview(wholeBought: number, samples: number) {
    const count = Math.max(1, Math.min(100, samples));
    const out = [];
    for (let i = 0; i < count; i += 1) {
      out.push(
        generateKPEG({
          wholeBought,
          walletAddress: "0xpreview",
          mintNonce: i,
          seedHint: `preview:${wholeBought}:${i}`
        })
      );
    }
    return out;
  }

  async setLatestIndexedBlock(blockNumber: number): Promise<void> {
    await this.db.run(`UPDATE chain_state SET latest_indexed_block = ? WHERE id = 1`, [blockNumber]);
  }

  async getLatestIndexedBlock(): Promise<number> {
    return this.latestIndexedBlock();
  }

  async setLatestTokenBalanceIndexedBlock(blockNumber: number): Promise<void> {
    try {
      await this.db.run(
        `INSERT INTO token_balance_state (id, latest_indexed_block)
         VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET latest_indexed_block = excluded.latest_indexed_block`,
        [blockNumber]
      );
    } catch {
      // Older read-only DBs may not have this additive index table yet.
    }
  }

  async getLatestTokenBalanceIndexedBlock(): Promise<number> {
    try {
      const row = await this.db.get<{ latest_indexed_block: number }>(
        `SELECT latest_indexed_block FROM token_balance_state WHERE id = 1`
      );
      return Number(row?.latest_indexed_block ?? 0);
    } catch {
      return 0;
    }
  }

  async getMaxKittyId(): Promise<number> {
    const row = await this.db.get<{ value: number | null }>(`SELECT MAX(id) AS value FROM kitties`);
    return Number(row?.value ?? 0);
  }

  async getLiveKittyCount(): Promise<number> {
    const row = await this.db.get<{ value: number }>(
      `SELECT COUNT(*) AS value FROM kitties WHERE burned_at IS NULL`
    );
    return Number(row?.value ?? 0);
  }

  async markSyncSuccess(completedAtMs = nowMs()): Promise<void> {
    try {
      await this.db.run(
        `INSERT INTO sync_status (
           id,
           last_sync_success_at_ms,
           last_sync_failed_at_ms,
           last_sync_phase,
           last_sync_from_block,
           last_sync_to_block,
           last_sync_event_kind,
           last_sync_tx_hash,
           last_sync_log_index,
           last_sync_error
         )
         VALUES (1, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
         ON CONFLICT(id) DO UPDATE SET
           last_sync_success_at_ms = excluded.last_sync_success_at_ms,
           last_sync_failed_at_ms = NULL,
           last_sync_phase = NULL,
           last_sync_from_block = NULL,
           last_sync_to_block = NULL,
           last_sync_event_kind = NULL,
           last_sync_tx_hash = NULL,
           last_sync_log_index = NULL,
           last_sync_error = NULL`,
        [completedAtMs]
      );
    } catch (error) {
      if (isMissingSyncStatusSchemaError(error)) {
        return;
      }
      throw error;
    }
  }

  async recordSyncFailure(input: SyncFailureInput): Promise<void> {
    try {
      await this.db.run(
        `INSERT INTO sync_status (
           id,
           last_sync_success_at_ms,
           last_sync_failed_at_ms,
           last_sync_phase,
           last_sync_from_block,
           last_sync_to_block,
           last_sync_event_kind,
           last_sync_tx_hash,
           last_sync_log_index,
           last_sync_error
         )
         VALUES (
           1,
           NULL,
           ?,
           ?,
           ?,
           ?,
           ?,
           ?,
           ?,
           ?
         )
         ON CONFLICT(id) DO UPDATE SET
           last_sync_failed_at_ms = excluded.last_sync_failed_at_ms,
           last_sync_phase = excluded.last_sync_phase,
           last_sync_from_block = excluded.last_sync_from_block,
           last_sync_to_block = excluded.last_sync_to_block,
           last_sync_event_kind = excluded.last_sync_event_kind,
           last_sync_tx_hash = excluded.last_sync_tx_hash,
           last_sync_log_index = excluded.last_sync_log_index,
           last_sync_error = excluded.last_sync_error`,
        [
          input.failedAtMs ?? nowMs(),
          input.phase,
          input.fromBlock ?? null,
          input.toBlock ?? null,
          input.eventKind ?? null,
          input.txHash ?? null,
          input.logIndex ?? null,
          input.error
        ]
      );
    } catch (error) {
      if (isMissingSyncStatusSchemaError(error)) {
        return;
      }
      throw error;
    }
  }

  async getSyncFailureStatus(): Promise<SyncFailureStatus> {
    try {
      const row = await this.db.get<SyncStatusRow>(
        `SELECT
           last_sync_success_at_ms,
           last_sync_failed_at_ms,
           last_sync_phase,
           last_sync_from_block,
           last_sync_to_block,
           last_sync_event_kind,
           last_sync_tx_hash,
           last_sync_log_index,
           last_sync_error
         FROM sync_status
         WHERE id = 1`
      );
      return {
        lastSyncSuccessAtMs: row?.last_sync_success_at_ms ?? null,
        lastSyncFailedAtMs: row?.last_sync_failed_at_ms ?? null,
        lastSyncPhase: (row?.last_sync_phase ?? null) as SyncFailurePhase | null,
        lastSyncFromBlock: row?.last_sync_from_block ?? null,
        lastSyncToBlock: row?.last_sync_to_block ?? null,
        lastSyncEventKind: row?.last_sync_event_kind ?? null,
        lastSyncTxHash: row?.last_sync_tx_hash ?? null,
        lastSyncLogIndex: row?.last_sync_log_index ?? null,
        lastSyncError: row?.last_sync_error ?? null
      };
    } catch (error) {
      if (isMissingSyncStatusSchemaError(error)) {
        return {
          lastSyncSuccessAtMs: null,
          lastSyncFailedAtMs: null,
          lastSyncPhase: null,
          lastSyncFromBlock: null,
          lastSyncToBlock: null,
          lastSyncEventKind: null,
          lastSyncTxHash: null,
          lastSyncLogIndex: null,
          lastSyncError: null
        };
      }
      throw error;
    }
  }

  async setSyncSnapshot(input: {
    headBlock: number | null;
    onchainKittiesLive: number | null;
    onchainKittiesEverMinted: number | null;
    updatedAtMs?: number;
  }): Promise<void> {
    try {
      await this.db.run(
        `INSERT INTO sync_snapshot (
           id,
           head_block,
           onchain_kitties_live,
           onchain_kitties_ever_minted,
           updated_at_ms
         )
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           head_block = excluded.head_block,
           onchain_kitties_live = excluded.onchain_kitties_live,
           onchain_kitties_ever_minted = excluded.onchain_kitties_ever_minted,
           updated_at_ms = excluded.updated_at_ms`,
        [
          input.headBlock,
          input.onchainKittiesLive,
          input.onchainKittiesEverMinted,
          input.updatedAtMs ?? nowMs()
        ]
      );
    } catch (error) {
      if (isMissingSyncSnapshotSchemaError(error)) {
        return;
      }
      throw error;
    }
  }

  async getSyncSnapshot(): Promise<{
    headBlock: number | null;
    onchainKittiesLive: number | null;
    onchainKittiesEverMinted: number | null;
    updatedAtMs: number | null;
  }> {
    try {
      const row = await this.db.get<SyncSnapshotRow>(
        `SELECT
           head_block,
           onchain_kitties_live,
           onchain_kitties_ever_minted,
           updated_at_ms
         FROM sync_snapshot
         WHERE id = 1`
      );
      return {
        headBlock: row?.head_block ?? null,
        onchainKittiesLive: row?.onchain_kitties_live ?? null,
        onchainKittiesEverMinted: row?.onchain_kitties_ever_minted ?? null,
        updatedAtMs: row ? Number(row.updated_at_ms ?? 0) : null
      };
    } catch (error) {
      if (isMissingSyncSnapshotSchemaError(error)) {
        return {
          headBlock: null,
          onchainKittiesLive: null,
          onchainKittiesEverMinted: null,
          updatedAtMs: null
        };
      }
      throw error;
    }
  }

  private repairJobFromRow(row: RepairJobRow): RepairJobState {
    const status = row.status as RepairJobStatus;
    return {
      jobName: row.job_name,
      version: Number(row.version),
      status: status === "pending" || status === "running" || status === "done" || status === "failed" ? status : "pending",
      fromBlock: Number(row.from_block),
      nextBlock: Number(row.next_block),
      targetBlock: row.target_block === null ? null : Number(row.target_block),
      updatedAtMs: Number(row.updated_at_ms ?? 0),
      lastError: row.last_error ?? null
    };
  }

  async getRepairJob(jobName: string): Promise<RepairJobState | null> {
    try {
      const row = await this.db.get<RepairJobRow>(
        `SELECT
           job_name,
           version,
           status,
           from_block,
           next_block,
           target_block,
           updated_at_ms,
           last_error
         FROM repair_jobs
         WHERE job_name = ?`,
        [jobName]
      );
      return row ? this.repairJobFromRow(row) : null;
    } catch (error) {
      if (isMissingRepairJobsSchemaError(error)) {
        return null;
      }
      throw error;
    }
  }

  async ensureRepairJob(input: {
    jobName: string;
    version: number;
    fromBlock: number;
    targetBlock: number;
  }): Promise<RepairJobState> {
    return this.db.transaction(async () => {
      const existing = await this.db.get<RepairJobRow>(
        `SELECT
           job_name,
           version,
           status,
           from_block,
           next_block,
           target_block,
           updated_at_ms,
           last_error
         FROM repair_jobs
         WHERE job_name = ?`,
        [input.jobName]
      );
      const now = nowMs();
      if (!existing || Number(existing.version) !== input.version) {
        await this.db.run(`DELETE FROM owner_kitty_history_repair`);
        await this.db.run(`DELETE FROM market_sales_repair`);
        await this.db.run(
          `INSERT INTO repair_jobs (
             job_name, version, status, from_block, next_block, target_block, updated_at_ms, last_error
           )
           VALUES (?, ?, 'pending', ?, ?, ?, ?, NULL)
           ON CONFLICT(job_name) DO UPDATE SET
             version = excluded.version,
             status = excluded.status,
             from_block = excluded.from_block,
             next_block = excluded.next_block,
             target_block = excluded.target_block,
             updated_at_ms = excluded.updated_at_ms,
             last_error = excluded.last_error`,
          [input.jobName, input.version, input.fromBlock, input.fromBlock, input.targetBlock, now]
        );
      } else {
        const existingTarget = Number(existing.target_block ?? 0);
        if (existing.status !== "done" && input.targetBlock > existingTarget) {
          await this.db.run(
            `UPDATE repair_jobs
             SET target_block = ?, updated_at_ms = ?
             WHERE job_name = ?`,
            [input.targetBlock, now, input.jobName]
          );
        }
      }
      const updated = await this.db.get<RepairJobRow>(
        `SELECT
           job_name,
           version,
           status,
           from_block,
           next_block,
           target_block,
           updated_at_ms,
           last_error
         FROM repair_jobs
         WHERE job_name = ?`,
        [input.jobName]
      );
      if (!updated) {
        throw new Error(`repair job ${input.jobName} could not be initialized`);
      }
      return this.repairJobFromRow(updated);
    });
  }

  async markRepairJobRunning(jobName: string): Promise<void> {
    await this.db.run(
      `UPDATE repair_jobs
       SET status = 'running', updated_at_ms = ?, last_error = NULL
       WHERE job_name = ?`,
      [nowMs(), jobName]
    );
  }

  async markRepairJobFailed(jobName: string, error: string): Promise<void> {
    await this.db.run(
      `UPDATE repair_jobs
       SET status = 'failed', updated_at_ms = ?, last_error = ?
       WHERE job_name = ?`,
      [nowMs(), error, jobName]
    );
  }

  async updateRepairJobProgress(input: {
    jobName: string;
    nextBlock: number;
    targetBlock: number;
    done?: boolean;
  }): Promise<RepairJobState> {
    await this.db.run(
      `UPDATE repair_jobs
       SET
         status = ?,
         next_block = ?,
         target_block = ?,
         updated_at_ms = ?,
         last_error = NULL
       WHERE job_name = ?`,
      [input.done ? "done" : "running", input.nextBlock, input.targetBlock, nowMs(), input.jobName]
    );
    const state = await this.getRepairJob(input.jobName);
    if (!state) {
      throw new Error(`repair job ${input.jobName} is missing`);
    }
    return state;
  }

  async appendOwnerKittyHistoryRepair(rows: OwnerKittyHistoryRepairInput[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const chunkSize = 200;
    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      const placeholders: string[] = [];
      const args: Array<string | number> = [];
      for (const row of chunk) {
        const owner = normalizeAddress(row.owner);
        if (isZeroAddress(owner)) {
          continue;
        }
        placeholders.push("(?, ?, ?)");
        args.push(owner, row.kittyId, row.firstSeenAt);
      }
      if (placeholders.length === 0) {
        continue;
      }
      await this.db.run(
        `INSERT OR IGNORE INTO owner_kitty_history_repair (owner, kitty_id, first_seen_at)
         VALUES ${placeholders.join(", ")}`,
        args
      );
    }
  }

  async upsertMarketSalesRepair(rows: MarketSaleRepairInput[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const chunkSize = 150;
    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      const placeholders: string[] = [];
      const args: Array<string | number> = [];
      for (const row of chunk) {
        placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?)");
        args.push(
          row.tradeId,
          normalizeAddress(row.seller),
          normalizeAddress(row.buyer),
          row.priceWei,
          row.feeWei,
          row.soldBlock,
          row.soldTxHash,
          row.soldAt
        );
      }
      await this.db.run(
        `INSERT INTO market_sales_repair (
           trade_id, seller, buyer, price_wei, fee_wei, sold_block, sold_tx_hash, sold_at
         )
         VALUES ${placeholders.join(", ")}
         ON CONFLICT(trade_id) DO UPDATE SET
           seller = excluded.seller,
           buyer = excluded.buyer,
           price_wei = excluded.price_wei,
           fee_wei = excluded.fee_wei,
           sold_block = excluded.sold_block,
           sold_tx_hash = excluded.sold_tx_hash,
           sold_at = excluded.sold_at`,
        args
      );
    }
  }

  async finalizeHistoryAggregateRepair(jobName: string): Promise<RepairJobState> {
    await this.db.transaction(async () => {
      await this.db.run(`DELETE FROM owner_kitty_history`);
      await this.db.run(
        `INSERT INTO owner_kitty_history (owner, kitty_id, first_seen_at)
         SELECT owner, kitty_id, first_seen_at
         FROM owner_kitty_history_repair`
      );

      await this.db.run(`DELETE FROM owner_stats`);
      await this.db.run(
        `INSERT INTO owner_stats (owner, current_kitties, ever_kitties)
         SELECT owner, COUNT(*), 0
         FROM kitties
         WHERE burned_at IS NULL AND owner != ?
         GROUP BY owner`,
        [ZERO_ADDRESS]
      );
      await this.db.run(
        `INSERT INTO owner_stats (owner, current_kitties, ever_kitties)
         SELECT owner, 0, COUNT(*)
         FROM owner_kitty_history
         WHERE owner != ?
         GROUP BY owner
         ON CONFLICT(owner) DO UPDATE SET ever_kitties = excluded.ever_kitties`,
        [ZERO_ADDRESS]
      );
      await this.db.run(
        `UPDATE owner_stats
         SET ever_kitties = CASE
           WHEN ever_kitties < current_kitties THEN current_kitties
           ELSE ever_kitties
         END`
      );

      await this.db.run(`DELETE FROM market_sales`);
      await this.db.run(
        `INSERT INTO market_sales (
           trade_id, seller, buyer, price_wei, fee_wei, sold_block, sold_tx_hash, sold_at
         )
         SELECT trade_id, seller, buyer, price_wei, fee_wei, sold_block, sold_tx_hash, sold_at
         FROM market_sales_repair`
      );
      const sales = await this.db.all<{ price_wei: string }>(`SELECT price_wei FROM market_sales`);
      const volumeWei = sales.reduce((total, row) => total + BigInt(row.price_wei), 0n).toString();
      await this.db.run(
        `INSERT INTO market_stats (id, volume_wei, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           volume_wei = excluded.volume_wei,
           updated_at = excluded.updated_at`,
        [volumeWei, nowMs()]
      );

      await this.db.run(
        `UPDATE repair_jobs
         SET
           status = 'done',
           next_block = COALESCE(target_block, next_block) + 1,
           updated_at_ms = ?,
           last_error = NULL
         WHERE job_name = ?`,
        [nowMs(), jobName]
      );
    });
    const state = await this.getRepairJob(jobName);
    if (!state) {
      throw new Error(`repair job ${jobName} is missing after finalize`);
    }
    return state;
  }

  private paginationSql(sort: SortMode): { sql: string; orderBy: string } {
    if (sort === "scarcity") {
      return { sql: "scarcity", orderBy: "ORDER BY rarity_score DESC, id DESC" };
    }
    return { sql: "latest", orderBy: "ORDER BY id DESC" };
  }

  private async everMintedKitties(): Promise<number> {
    const row = (await this.db.get<{ kitties_ever_minted: number }>(
      `SELECT kitties_ever_minted FROM global_stats WHERE id = 1`
    )) ?? { kitties_ever_minted: 0 };
    return row.kitties_ever_minted;
  }

  private async marketRowsWithKitties(
    rows: MarketListingRow[],
    kittyMode: "list" | "detail" = "list"
  ): Promise<Array<ReturnType<typeof toMarketDto>>> {
    if (rows.length === 0) {
      return [];
    }
    const kittyIdsByTradeId = new Map<number, number[]>();
    const uniqueKittyIds = new Set<number>();
    for (const row of rows) {
      const kittyIds = JSON.parse(row.kitty_ids_json) as number[];
      kittyIdsByTradeId.set(row.trade_id, kittyIds);
      for (const kittyId of kittyIds) {
        uniqueKittyIds.add(kittyId);
      }
    }

    const kittyById = new Map<number, KittyRow>();
    if (uniqueKittyIds.size > 0) {
      const kittyIds = [...uniqueKittyIds];
      const placeholders = kittyIds.map(() => "?").join(", ");
      const kittyRows = await this.db.all<KittyRow>(
        `SELECT * FROM kitties WHERE id IN (${placeholders})`,
        kittyIds
      );
      for (const kitty of kittyRows) {
        kittyById.set(kitty.id, kitty);
      }
    }

    return rows.map((row) => {
      const kittyIds = kittyIdsByTradeId.get(row.trade_id) ?? [];
      const kitties = kittyIds.flatMap((kittyId) => {
        const kitty = kittyById.get(kittyId);
        if (!kitty) {
          return [];
        }
        return [kittyMode === "detail" ? toKittyDto(kitty) : toKittyListDto(kitty)];
      });
      return toMarketDto(row, kitties);
    });
  }

  private async latestIndexedBlock(): Promise<number> {
    const row = (await this.db.get<{ latest_indexed_block: number }>(
      `SELECT latest_indexed_block FROM chain_state WHERE id = 1`
    )) ?? { latest_indexed_block: 0 };
    return row.latest_indexed_block;
  }
}
