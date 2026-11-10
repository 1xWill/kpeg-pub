import { describe, expect, it } from "vitest";
import { compareChainEvents, getLogsInChunks } from "../src/chain.js";

describe("chain sync log chunking", () => {
  it("splits large eth_getLogs ranges into smaller requests", async () => {
    const calls: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    const client = {
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        calls.push({ fromBlock, toBlock });
        return [{ blockNumber: fromBlock, logIndex: 0, transactionIndex: 0 }];
      }
    };

    const logs = await getLogsInChunks(client, {
      address: "0x0000000000000000000000000000000000000001",
      fromBlock: 1n,
      toBlock: 12_000n
    } as never, 5_000n);

    expect(calls).toEqual([
      { fromBlock: 1n, toBlock: 5_000n },
      { fromBlock: 5_001n, toBlock: 10_000n },
      { fromBlock: 10_001n, toBlock: 12_000n }
    ]);
    expect(logs).toHaveLength(3);
  });

  it("orders same-transaction kitty moves before market events", () => {
    const txHash = `0x${"1".repeat(64)}` as const;
    const events = [
      {
        kind: "market-created" as const,
        log: { blockNumber: 10n, transactionHash: txHash, transactionIndex: 0, logIndex: 1 }
      },
      {
        kind: "batch-move" as const,
        log: { blockNumber: 10n, transactionHash: txHash, transactionIndex: 0, logIndex: 2 }
      },
      {
        kind: "market-params" as const,
        log: { blockNumber: 11n, transactionHash: `0x${"2".repeat(64)}`, transactionIndex: 0, logIndex: 0 }
      }
    ];

    expect(events.sort(compareChainEvents).map((event) => event.kind)).toEqual([
      "batch-move",
      "market-created",
      "market-params"
    ]);
  });
});
