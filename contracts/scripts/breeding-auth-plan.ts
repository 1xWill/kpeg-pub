import { ethers } from "hardhat";
import type { DeploymentRecord } from "./lib";

export type BreedingAuthPlan = {
  create2Deployer?: string;
  salt: string;
  initCodeHash: string;
  runtimeCodeHash: string;
};

type DeploymentWithBreedingAuthPlan = DeploymentRecord & {
  breedingCreate2: NonNullable<DeploymentRecord["breedingCreate2"]>;
  breedingContractRuntimeCodeHash: string;
};

function envOptional(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function assertBytes32(value: string, label: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a bytes32 hex string`);
  }
}

function hasSavedBreedingAuthPlan(deployment: DeploymentRecord): deployment is DeploymentWithBreedingAuthPlan {
  return Boolean(deployment.breedingCreate2 && deployment.breedingContractRuntimeCodeHash);
}

export function resolveBreedingAuthPlan(
  deployment: DeploymentRecord,
  env: NodeJS.ProcessEnv = process.env
): BreedingAuthPlan {
  if (envOptional("KPEG_BREEDING_CONTRACT_ADDRESS", env)) {
    throw new Error("KPEG_BREEDING_CONTRACT_ADDRESS is not accepted. Use CREATE2 hash inputs.");
  }

  const envCreate2Deployer = envOptional("KPEG_BREEDING_CREATE2_DEPLOYER_ADDRESS", env);
  const envSalt = envOptional("KPEG_BREEDING_CREATE2_SALT", env);
  const envInitCodeHash = envOptional("KPEG_BREEDING_INIT_CODE_HASH", env);
  const envRuntimeCodeHash = envOptional("KPEG_BREEDING_RUNTIME_CODE_HASH", env);
  const hasAnyEnvInput = [envCreate2Deployer, envSalt, envInitCodeHash, envRuntimeCodeHash].some(Boolean);
  const savedPlan = hasSavedBreedingAuthPlan(deployment) ? deployment : null;

  if (hasAnyEnvInput) {
    if (!envSalt || !envInitCodeHash || !envRuntimeCodeHash) {
      if (savedPlan) {
        if (envCreate2Deployer && envCreate2Deployer.toLowerCase() !== savedPlan.breedingCreate2.deployer.toLowerCase()) {
          throw new Error(
            `KPEG_BREEDING_CREATE2_DEPLOYER_ADDRESS differs from saved deployment plan: expected ${savedPlan.breedingCreate2.deployer}, got ${envCreate2Deployer}`
          );
        }
        if (envSalt && envSalt.toLowerCase() !== savedPlan.breedingCreate2.salt.toLowerCase()) {
          throw new Error(
            `KPEG_BREEDING_CREATE2_SALT differs from saved deployment plan: expected ${savedPlan.breedingCreate2.salt}, got ${envSalt}`
          );
        }
        if (envInitCodeHash && envInitCodeHash.toLowerCase() !== savedPlan.breedingCreate2.initCodeHash.toLowerCase()) {
          throw new Error(
            `KPEG_BREEDING_INIT_CODE_HASH differs from saved deployment plan: expected ${savedPlan.breedingCreate2.initCodeHash}, got ${envInitCodeHash}`
          );
        }
        if (envRuntimeCodeHash && envRuntimeCodeHash.toLowerCase() !== savedPlan.breedingContractRuntimeCodeHash.toLowerCase()) {
          throw new Error(
            `KPEG_BREEDING_RUNTIME_CODE_HASH differs from saved deployment plan: expected ${savedPlan.breedingContractRuntimeCodeHash}, got ${envRuntimeCodeHash}`
          );
        }
        return savedBreedingAuthPlan(savedPlan);
      }
      throw new Error(
        "When overriding plan via env, set KPEG_BREEDING_CREATE2_SALT, KPEG_BREEDING_INIT_CODE_HASH, and KPEG_BREEDING_RUNTIME_CODE_HASH."
      );
    }
    if (envCreate2Deployer && !ethers.isAddress(envCreate2Deployer)) {
      throw new Error("KPEG_BREEDING_CREATE2_DEPLOYER_ADDRESS must be a valid address");
    }
    assertBytes32(envSalt, "KPEG_BREEDING_CREATE2_SALT");
    assertBytes32(envInitCodeHash, "KPEG_BREEDING_INIT_CODE_HASH");
    assertBytes32(envRuntimeCodeHash, "KPEG_BREEDING_RUNTIME_CODE_HASH");
    return {
      create2Deployer: envCreate2Deployer ?? deployment.breedingCreate2?.deployer,
      salt: envSalt,
      initCodeHash: envInitCodeHash,
      runtimeCodeHash: envRuntimeCodeHash
    };
  }

  if (!savedPlan) {
    throw new Error(
      "Missing saved breeding authorization plan. Run prepare-breeding-gateway:<network>, or provide KPEG_BREEDING_CREATE2_* overrides."
    );
  }

  return savedBreedingAuthPlan(savedPlan);
}

function savedBreedingAuthPlan(deployment: DeploymentWithBreedingAuthPlan): BreedingAuthPlan {
  if (!ethers.isAddress(deployment.breedingCreate2.deployer)) {
    throw new Error(`Saved breedingCreate2.deployer is invalid: ${deployment.breedingCreate2.deployer}`);
  }
  assertBytes32(deployment.breedingCreate2.salt, "deployment.breedingCreate2.salt");
  assertBytes32(deployment.breedingCreate2.initCodeHash, "deployment.breedingCreate2.initCodeHash");
  assertBytes32(deployment.breedingContractRuntimeCodeHash, "deployment.breedingContractRuntimeCodeHash");

  return {
    create2Deployer: deployment.breedingCreate2.deployer,
    salt: deployment.breedingCreate2.salt,
    initCodeHash: deployment.breedingCreate2.initCodeHash,
    runtimeCodeHash: deployment.breedingContractRuntimeCodeHash
  };
}
