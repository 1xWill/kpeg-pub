import { expect } from "chai";
import {
  assertGatewayRenouncePreconditions,
  assertRouterRenouncePreconditions,
  assertTokenRenouncePreconditions,
  requireMarketFinalConfirmation
} from "../scripts/renounce-ownership-preflight";

const ADDR = {
  token: "0x1111111111111111111111111111111111111111",
  hook: "0x2222222222222222222222222222222222222222",
  weth: "0x3333333333333333333333333333333333333333",
  gateway: "0x4444444444444444444444444444444444444444",
  engine: "0x5555555555555555555555555555555555555555"
};

describe("renounce ownership preflight", () => {
  it("rejects token renounce when breeding auth is not set", () => {
    expect(() =>
      assertTokenRenouncePreconditions({
        started: true,
        tokenHook: ADDR.hook,
        expectedHook: ADDR.hook,
        deploymentBreedingContract: undefined,
        tokenBreedingContract: ADDR.gateway,
        deploymentBreedingContractRuntimeCodeHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        tokenBreedingContractCodeHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      })
    ).to.throw("deployment.breedingContract missing");
  });

  it("rejects token renounce when breeding code hash mismatches", () => {
    expect(() =>
      assertTokenRenouncePreconditions({
        started: true,
        tokenHook: ADDR.hook,
        expectedHook: ADDR.hook,
        deploymentBreedingContract: ADDR.gateway,
        tokenBreedingContract: ADDR.gateway,
        deploymentBreedingContractRuntimeCodeHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        tokenBreedingContractCodeHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      })
    ).to.throw("token.breedingContractCodeHash mismatch");
  });

  it("rejects router renounce before pool is initialized", () => {
    expect(() =>
      assertRouterRenouncePreconditions({
        poolInitialized: false,
        currency0: ADDR.token,
        currency1: ADDR.weth,
        deploymentToken: ADDR.token,
        deploymentWeth: ADDR.weth,
        poolHook: ADDR.hook,
        deploymentHook: ADDR.hook,
        poolFee: 3000,
        deploymentFee: 3000,
        poolTickSpacing: 60,
        deploymentTickSpacing: 60
      })
    ).to.throw("router.poolInitialized() is false");
  });

  it("rejects gateway renounce before freeze/engine auth", () => {
    expect(() =>
      assertGatewayRenouncePreconditions({
        gatewaySelected: true,
        gatewayPresent: true,
        authorizationsFrozen: false,
        engineAddress: ADDR.engine,
        engineAuthorized: true
      })
    ).to.throw("authorizations are not frozen");

    expect(() =>
      assertGatewayRenouncePreconditions({
        gatewaySelected: true,
        gatewayPresent: true,
        authorizationsFrozen: true,
        engineAddress: ADDR.engine,
        engineAuthorized: false
      })
    ).to.throw("does not authorize breeding engine");
  });

  it("requires explicit final market-fee confirmation", () => {
    expect(() => requireMarketFinalConfirmation(undefined)).to.throw("KPEG_CONFIRM_MARKET_FINAL=1");
    expect(() => requireMarketFinalConfirmation("0")).to.throw("KPEG_CONFIRM_MARKET_FINAL=1");
    expect(() => requireMarketFinalConfirmation("1")).to.not.throw();
  });
});
