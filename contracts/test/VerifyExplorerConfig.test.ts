import { expect } from "chai";
import { explorerApiKey, explorerApiKeyEnvName } from "../scripts/verify-env";

describe("explorer verification API key config", () => {
  it("returns a single string key so hardhat-verify uses Etherscan API v2", () => {
    expect(explorerApiKey({ BASESCAN_API_KEY: "base-key" })).to.equal("base-key");
  });

  it("prefers the canonical Etherscan v2 key env over the legacy BaseScan alias", () => {
    expect(explorerApiKey({ ETHERSCAN_API_KEY: "etherscan-key", BASESCAN_API_KEY: "base-key" })).to.equal(
      "etherscan-key"
    );
    expect(explorerApiKeyEnvName({ ETHERSCAN_API_KEY: "etherscan-key", BASESCAN_API_KEY: "base-key" })).to.equal(
      "ETHERSCAN_API_KEY"
    );
  });

  it("ignores blank key env values", () => {
    expect(explorerApiKey({ ETHERSCAN_API_KEY: " ", BASESCAN_API_KEY: "\nbase-key\t" })).to.equal("base-key");
    expect(explorerApiKeyEnvName({ ETHERSCAN_API_KEY: " ", BASESCAN_API_KEY: "\nbase-key\t" })).to.equal(
      "BASESCAN_API_KEY"
    );
  });
});
