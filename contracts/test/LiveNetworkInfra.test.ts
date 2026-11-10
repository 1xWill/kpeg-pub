import { expect } from "chai";
import { liveNetworkInfra } from "../scripts/lib";

describe("liveNetworkInfra", () => {
  it("returns the built-in Base Sepolia infra mapping", () => {
    expect(liveNetworkInfra("baseSepolia")).to.deep.equal({
      poolManager: "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408",
      weth: "0x4200000000000000000000000000000000000006",
      positionManager: "0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80",
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3"
    });
  });

  it("returns the built-in Base Mainnet infra mapping", () => {
    expect(liveNetworkInfra("baseMainnet")).to.deep.equal({
      poolManager: "0x498581ff718922c3f8e6a244956af099b2652b2b",
      weth: "0x4200000000000000000000000000000000000006",
      positionManager: "0x7c5f5a4bbd8fd63184577525326123b519429bdc",
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3"
    });
  });

  it("returns undefined for unknown networks", () => {
    expect(liveNetworkInfra("unknown")).to.equal(undefined);
  });
});
