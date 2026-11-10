import { expect } from "chai";
import { resolveBreedingAuthPlan } from "../scripts/breeding-auth-plan";
import type { DeploymentRecord } from "../scripts/lib";

function mockDeployment(overrides?: Partial<DeploymentRecord>): DeploymentRecord {
  return {
    network: "localhost",
    chainId: 31337,
    deployer: "0x1111111111111111111111111111111111111111",
    artSources: {
      backgrounds: [],
      breeds: [],
      clothes: [],
      moods: [],
      marks: [],
      mouths: [],
      eyes: [],
      accessories: []
    },
    renderer: "0x2222222222222222222222222222222222222222",
    token: "0x3333333333333333333333333333333333333333",
    market: "0x4444444444444444444444444444444444444444",
    hook: "0x5555555555555555555555555555555555555555",
    hookDeployer: "0x6666666666666666666666666666666666666666",
    router: "0x7777777777777777777777777777777777777777",
    quoter: "0x8888888888888888888888888888888888888888",
    poolManager: "0x9999999999999999999999999999999999999999",
    weth: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    tokenIsCurrency0: true,
    fee: 3000,
    tickSpacing: 60,
    deployedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("resolveBreedingAuthPlan", () => {
  const deploymentPlan = {
    breedingCreate2: {
      deployer: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      salt: "0x00000000000000000000000000000000000000000000000000000000000000aa",
      initCodeHash: "0x1111111111111111111111111111111111111111111111111111111111111111"
    },
    breedingContractRuntimeCodeHash: "0x2222222222222222222222222222222222222222222222222222222222222222"
  };

  it("falls back to deployment plan when env overrides are absent", () => {
    const deployment = mockDeployment(deploymentPlan);
    const resolved = resolveBreedingAuthPlan(deployment, {});

    expect(resolved).to.deep.equal({
      create2Deployer: deploymentPlan.breedingCreate2.deployer,
      salt: deploymentPlan.breedingCreate2.salt,
      initCodeHash: deploymentPlan.breedingCreate2.initCodeHash,
      runtimeCodeHash: deploymentPlan.breedingContractRuntimeCodeHash
    });
  });

  it("uses explicit env override values when provided", () => {
    const deployment = mockDeployment(deploymentPlan);
    const resolved = resolveBreedingAuthPlan(deployment, {
      KPEG_BREEDING_CREATE2_DEPLOYER_ADDRESS: "0xcccccccccccccccccccccccccccccccccccccccc",
      KPEG_BREEDING_CREATE2_SALT: "0x00000000000000000000000000000000000000000000000000000000000000bb",
      KPEG_BREEDING_INIT_CODE_HASH: "0x3333333333333333333333333333333333333333333333333333333333333333",
      KPEG_BREEDING_RUNTIME_CODE_HASH: "0x4444444444444444444444444444444444444444444444444444444444444444"
    });

    expect(resolved).to.deep.equal({
      create2Deployer: "0xcccccccccccccccccccccccccccccccccccccccc",
      salt: "0x00000000000000000000000000000000000000000000000000000000000000bb",
      initCodeHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
      runtimeCodeHash: "0x4444444444444444444444444444444444444444444444444444444444444444"
    });
  });

  it("rejects partial env overrides", () => {
    const deployment = mockDeployment();
    expect(() =>
      resolveBreedingAuthPlan(deployment, {
        KPEG_BREEDING_CREATE2_SALT: "0x00000000000000000000000000000000000000000000000000000000000000bb"
      })
    ).to.throw("When overriding plan via env");
  });

  it("uses the saved deployment plan when a matching salt remains exported", () => {
    const deployment = mockDeployment(deploymentPlan);
    const resolved = resolveBreedingAuthPlan(deployment, {
      KPEG_BREEDING_CREATE2_SALT: deploymentPlan.breedingCreate2.salt
    });

    expect(resolved).to.deep.equal({
      create2Deployer: deploymentPlan.breedingCreate2.deployer,
      salt: deploymentPlan.breedingCreate2.salt,
      initCodeHash: deploymentPlan.breedingCreate2.initCodeHash,
      runtimeCodeHash: deploymentPlan.breedingContractRuntimeCodeHash
    });
  });

  it("rejects a partial env value that differs from the saved deployment plan", () => {
    const deployment = mockDeployment(deploymentPlan);
    expect(() =>
      resolveBreedingAuthPlan(deployment, {
        KPEG_BREEDING_CREATE2_SALT: "0x00000000000000000000000000000000000000000000000000000000000000cc"
      })
    ).to.throw("differs from saved deployment plan");
  });

  it("rejects missing plan when neither env nor deployment has values", () => {
    const deployment = mockDeployment();
    expect(() => resolveBreedingAuthPlan(deployment, {})).to.throw("Missing saved breeding authorization plan");
  });

  it("rejects legacy raw breeding contract env variable", () => {
    const deployment = mockDeployment(deploymentPlan);
    expect(() =>
      resolveBreedingAuthPlan(deployment, {
        KPEG_BREEDING_CONTRACT_ADDRESS: "0xdeadbeef"
      })
    ).to.throw("KPEG_BREEDING_CONTRACT_ADDRESS is not accepted");
  });
});
