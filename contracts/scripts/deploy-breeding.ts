import { ethers, network } from "hardhat";
import { readDeployment, writeDeployment } from "./lib";

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("KPEG_DEPLOYER_PRIVATE_KEY is required for this network");
  }

  const deployment = await readDeployment(network.name);
  if (!deployment.token) {
    throw new Error(`Missing token address in deployments/${network.name}.json`);
  }
  if (!deployment.breedingContract) {
    throw new Error(`Missing breedingContract (birth gateway) in deployments/${network.name}.json`);
  }
  if (!deployment.hook) {
    throw new Error(`Missing hook entropy source in deployments/${network.name}.json`);
  }

  const initialOwner = process.env.KPEG_BREEDING_OWNER?.trim() || deployer.address;
  if (!ethers.isAddress(initialOwner)) {
    throw new Error(`Invalid KPEG_BREEDING_OWNER: ${initialOwner}`);
  }

  const BreedingFactory = await ethers.getContractFactory("KPEGBreeding");
  const breeding = await BreedingFactory.deploy(deployment.token, deployment.breedingContract, deployment.hook, initialOwner);
  await breeding.waitForDeployment();
  const breedingAddress = await breeding.getAddress();
  console.log(`KPEGBreeding deployed: ${breedingAddress}`);

  const deploymentPath = await writeDeployment(network.name, {
    ...deployment,
    breeding: breedingAddress,
    breedingEngine: breedingAddress,
    deployedAt: new Date().toISOString()
  });
  console.log(`Deployment updated: ${deploymentPath}`);

  const GatewayFactory = await ethers.getContractFactory("KPEGBirthGateway");
  const gateway = GatewayFactory.attach(deployment.breedingContract);
  const gatewayOwner = await gateway.owner();
  const signerIsGatewayOwner = gatewayOwner.toLowerCase() === deployer.address.toLowerCase();
  const alreadyAuthorized = await gateway.authorizedCallers(breedingAddress);
  const authorizationsFrozen = await gateway.authorizationsFrozen();

  if (!alreadyAuthorized) {
    if (authorizationsFrozen) {
      throw new Error(
        `Gateway authorization is frozen and ${breedingAddress} is not authorized. Deployment cannot proceed safely.`
      );
    }
    if (signerIsGatewayOwner) {
      await (await gateway.setAuthorizedCaller(breedingAddress, true)).wait();
      console.log(`KPEGBirthGateway authorized caller: ${breedingAddress}`);
    } else {
      const calldata = GatewayFactory.interface.encodeFunctionData("setAuthorizedCaller", [breedingAddress, true]);
      console.log("Manual gateway authorization required:");
      console.log(`  gateway: ${deployment.breedingContract}`);
      console.log(`  owner:   ${gatewayOwner}`);
      console.log(`  calldata:${calldata}`);
      throw new Error("Gateway owner differs from deployer; run setAuthorizedCaller via gateway owner/multisig.");
    }
  } else {
    console.log(`KPEGBirthGateway already authorized: ${breedingAddress}`);
  }

  const frozenAfterAuth = await gateway.authorizationsFrozen();
  if (!frozenAfterAuth) {
    if (signerIsGatewayOwner) {
      await (await gateway.freezeAuthorizations()).wait();
      console.log("KPEGBirthGateway authorizations frozen.");
    } else {
      const calldata = GatewayFactory.interface.encodeFunctionData("freezeAuthorizations");
      console.log("Manual gateway freeze required:");
      console.log(`  gateway: ${deployment.breedingContract}`);
      console.log(`  owner:   ${gatewayOwner}`);
      console.log(`  calldata:${calldata}`);
      throw new Error("Gateway owner differs from deployer; run freezeAuthorizations via gateway owner/multisig.");
    }
  } else {
    console.log("KPEGBirthGateway authorizations already frozen.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
