import { expect } from "chai";
import { partitionVerificationTargets } from "../scripts/verify-deployment";

describe("partitionVerificationTargets", () => {
  it("skips targets without deployed bytecode and keeps the rest", async () => {
    const targets = [
      {
        name: "deployed",
        address: "0x0000000000000000000000000000000000000001",
        contract: "src/A.sol:A",
        constructorArguments: []
      },
      {
        name: "planned",
        address: "0x0000000000000000000000000000000000000002",
        contract: "src/B.sol:B",
        constructorArguments: []
      }
    ];

    const { ready, skipped } = await partitionVerificationTargets(targets, async (address) =>
      address.endsWith("1") ? "0x1234" : "0x"
    );

    expect(ready).to.have.length(1);
    expect(ready[0]?.name).to.equal("deployed");
    expect(skipped).to.deep.equal([
      {
        name: "planned",
        address: "0x0000000000000000000000000000000000000002",
        reason: "no deployed bytecode yet"
      }
    ]);
  });
});
