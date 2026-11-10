import { expect } from "chai";
import {
  applySlippage,
  DEFAULT_MAX_TX_GAS_LIMIT,
  findMaxWholeSellable,
  isTxGasCapError,
  parseWholeSellArg,
  wholeToAmount
} from "../scripts/sell-kpeg-lib";
import { rpcOverrideEnv } from "../scripts/sell-kpeg-cli-lib";

describe("sell-kpeg script helpers", () => {
  it("parses whole sell arguments", () => {
    expect(parseWholeSellArg(undefined)).to.equal("max");
    expect(parseWholeSellArg("max")).to.equal("max");
    expect(parseWholeSellArg("all")).to.equal("max");
    expect(parseWholeSellArg("100")).to.equal(100n);
    expect(() => parseWholeSellArg("0")).to.throw("--whole must be greater than 0");
    expect(() => parseWholeSellArg("1.5")).to.throw("Invalid --whole value");
  });

  it("converts whole sells into token wei", () => {
    expect(wholeToAmount(1n)).to.equal(10n ** 18n);
    expect(wholeToAmount(171n)).to.equal(171n * 10n ** 18n);
  });

  it("applies slippage and exposes the default tx gas cap", () => {
    expect(DEFAULT_MAX_TX_GAS_LIMIT).to.equal(29_000_000n);
    expect(applySlippage(1000n, 1000n)).to.equal(900n);
  });

  it("finds the highest sellable whole amount", async () => {
    const max = await findMaxWholeSellable(171n, async (whole) => whole <= 170n);
    expect(max).to.equal(170n);
  });

  it("can be reused for chunked follow-up sells", async () => {
    const max = await findMaxWholeSellable(171n, async (whole) => whole <= 170n);
    expect(max).to.equal(170n);
  });

  it("maps custom rpc overrides to the selected network", () => {
    expect(rpcOverrideEnv("base-mainnet", "https://mainnet.base.org")).to.deep.equal({
      KPEG_BASE_MAINNET_RPC_URL: "https://mainnet.base.org"
    });
    expect(rpcOverrideEnv("base-sepolia", "https://sepolia.base.org")).to.deep.equal({
      KPEG_BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org"
    });
    expect(rpcOverrideEnv("localhost", "http://127.0.0.1:8545")).to.deep.equal({
      KPEG_LOCAL_RPC_URL: "http://127.0.0.1:8545"
    });
    expect(rpcOverrideEnv("base-mainnet")).to.deep.equal({});
  });

  it("recognizes rpc tx gas cap errors", () => {
    expect(isTxGasCapError(new Error("ProviderError: exceeds max transaction gas limit"))).to.equal(true);
    expect(isTxGasCapError(new Error("server returned an error response: error code -32003: gas limit too high"))).to.equal(true);
    expect(isTxGasCapError(new Error("execution reverted"))).to.equal(false);
  });
});
