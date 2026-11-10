import { ethers, network } from "hardhat";
import { assertContractCode, readDeployment, writeDeployment } from "./lib";
import { resolveBreedingAuthPlan } from "./breeding-auth-plan";

async function getOwnedCreate2DeployerOwner(address: string): Promise<string> {
  await assertContractCode(address, "KPEG_BREEDING_CREATE2_DEPLOYER_ADDRESS");
  const ownedCreate2 = await ethers.getContractAt(["function owner() view returns (address)"], address);
  return ownedCreate2.owner();
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("KPEG_DEPLOYER_PRIVATE_KEY is required for this network");
  }

  const deployment = await readDeployment(network.name);
  const plan = resolveBreedingAuthPlan(deployment);
  const token = await ethers.getContractAt("KPEGToken", deployment.token);
  if (await token.started()) {
    throw new Error("KPEGToken already started; breeding authorization must be set before bootstrap/start.");
  }
  if ((await token.breedingContract()) !== ethers.ZeroAddress) {
    throw new Error(`KPEGToken breeding contract is already set: ${await token.breedingContract()}`);
  }

  let create2Deployer = plan.create2Deployer;
  if (create2Deployer) {
    const owner = await getOwnedCreate2DeployerOwner(create2Deployer);
    console.log(`OwnedCreate2Deployer owner: ${owner}`);
  } else {
    const OwnedCreate2Factory = await ethers.getContractFactory("OwnedCreate2Deployer");
    const ownedCreate2 = await OwnedCreate2Factory.deploy(deployer.address);
    await ownedCreate2.waitForDeployment();
    create2Deployer = await ownedCreate2.getAddress();
    console.log(`OwnedCreate2Deployer deployed for breeding: ${create2Deployer}`);
  }

  const breedingContract = ethers.getCreate2Address(create2Deployer, plan.salt, plan.initCodeHash);
  if (deployment.breedingContract && deployment.breedingContract.toLowerCase() !== breedingContract.toLowerCase()) {
    throw new Error(
      `Breeding contract address mismatch in deployment record: expected ${deployment.breedingContract}, got ${breedingContract}`
    );
  }
  const existingCode = await ethers.provider.getCode(breedingContract);
  if (existingCode !== "0x") {
    const existingCodeHash = ethers.keccak256(existingCode as `0x${string}`);
    if (existingCodeHash.toLowerCase() !== plan.runtimeCodeHash.toLowerCase()) {
      throw new Error(
        `Breeding contract code hash mismatch at ${breedingContract}: expected ${plan.runtimeCodeHash}, got ${existingCodeHash}`
      );
    }
  }

  await (await token.setBreedingContract(breedingContract, plan.runtimeCodeHash)).wait();
  await writeDeployment(network.name, {
    ...deployment,
    breedingContract,
    breedingContractRuntimeCodeHash: plan.runtimeCodeHash,
    breedingCreate2: {
      deployer: create2Deployer,
      salt: plan.salt,
      initCodeHash: plan.initCodeHash
    }
  });

  console.log(
    JSON.stringify(
      {
        token: deployment.token,
        breedingContract,
        breedingContractRuntimeCodeHash: plan.runtimeCodeHash,
        breedingCreate2: { deployer: create2Deployer, salt: plan.salt, initCodeHash: plan.initCodeHash }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
