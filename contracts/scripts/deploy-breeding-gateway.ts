import { ethers, network } from "hardhat";
import { assertContractCode, readDeployment, writeDeployment } from "./lib";

type CliArgs = {
  gatewayOwner?: string;
  initialAuthorizedCaller?: string;
};

function envOrArg(name: string, cliValue?: string): string | undefined {
  if (cliValue && cliValue.length > 0) {
    return cliValue;
  }
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
}

function parseArgs(): CliArgs {
  return {
    gatewayOwner: argValue("--gateway-owner"),
    initialAuthorizedCaller: argValue("--initial-authorized-caller")
  };
}

async function ownedCreate2Deployer(address: string) {
  await assertContractCode(address, "breedingCreate2.deployer");
  return ethers.getContractAt(
    ["function owner() view returns (address)", "function deployCode(bytes32 salt, bytes creationCode) returns (address)"],
    address
  );
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("KPEG_DEPLOYER_PRIVATE_KEY is required for this network");
  }

  const cli = parseArgs();
  const deployment = await readDeployment(network.name);
  if (!deployment.breedingCreate2) {
    throw new Error(
      "Missing breedingCreate2 plan in deployment record. Run prepare-breeding-gateway:<network> first."
    );
  }
  if (!deployment.breedingContractRuntimeCodeHash) {
    throw new Error(
      "Missing breedingContractRuntimeCodeHash in deployment record. Run prepare-breeding-gateway:<network> first."
    );
  }

  const tokenAddress = deployment.token;
  const gatewayOwner =
    envOrArg("KPEG_BIRTH_GATEWAY_OWNER", cli.gatewayOwner) ?? deployment.breedingGateway?.owner;
  const initialAuthorizedCaller =
    envOrArg("KPEG_BIRTH_GATEWAY_INITIAL_AUTHORIZED_CALLER", cli.initialAuthorizedCaller) ??
    deployment.breedingGateway?.initialAuthorizedCaller ??
    ethers.ZeroAddress;
  if (!gatewayOwner || !ethers.isAddress(gatewayOwner)) {
    throw new Error(
      "Missing gateway owner. Pass --gateway-owner 0x... (or KPEG_BIRTH_GATEWAY_OWNER) so init code can be reconstructed."
    );
  }
  if (!ethers.isAddress(initialAuthorizedCaller)) {
    throw new Error(
      `KPEG_BIRTH_GATEWAY_INITIAL_AUTHORIZED_CALLER must be a valid address: ${initialAuthorizedCaller}`
    );
  }

  const ownedCreate2 = await ownedCreate2Deployer(deployment.breedingCreate2.deployer);
  const create2Owner = await ownedCreate2.owner();
  console.log(`OwnedCreate2Deployer owner: ${create2Owner}`);

  const GatewayFactory = await ethers.getContractFactory("KPEGBirthGateway");
  const constructorArgs = GatewayFactory.interface.encodeDeploy([gatewayOwner, tokenAddress, initialAuthorizedCaller]);
  const initCode = ethers.concat([GatewayFactory.bytecode as `0x${string}`, constructorArgs as `0x${string}`]);
  const initCodeHash = ethers.keccak256(initCode);
  if (initCodeHash.toLowerCase() !== deployment.breedingCreate2.initCodeHash.toLowerCase()) {
    throw new Error(
      `Init code hash mismatch: expected ${deployment.breedingCreate2.initCodeHash}, got ${initCodeHash}. Constructor args changed.`
    );
  }

  const derivedRuntimeBytecode = await ethers.provider.call({ from: deployer.address, data: initCode });
  if (derivedRuntimeBytecode === "0x") {
    throw new Error("Failed to derive KPEGBirthGateway runtime bytecode from init code.");
  }
  const runtimeCodeHash = ethers.keccak256(derivedRuntimeBytecode as `0x${string}`);
  if (runtimeCodeHash.toLowerCase() !== deployment.breedingContractRuntimeCodeHash.toLowerCase()) {
    throw new Error(
      `Runtime code hash mismatch: expected ${deployment.breedingContractRuntimeCodeHash}, got ${runtimeCodeHash}.`
    );
  }

  const predictedAddress = ethers.getCreate2Address(
    deployment.breedingCreate2.deployer,
    deployment.breedingCreate2.salt,
    deployment.breedingCreate2.initCodeHash
  );
  if (deployment.breedingContract && deployment.breedingContract.toLowerCase() !== predictedAddress.toLowerCase()) {
    throw new Error(
      `Breeding contract address mismatch in deployment record: expected ${deployment.breedingContract}, got ${predictedAddress}`
    );
  }

  const existingCode = await ethers.provider.getCode(predictedAddress);
  if (existingCode === "0x") {
    if (create2Owner.toLowerCase() === deployer.address.toLowerCase()) {
      await (await ownedCreate2.deployCode(deployment.breedingCreate2.salt, initCode)).wait();
    } else {
      const deployCalldata = ownedCreate2.interface.encodeFunctionData("deployCode", [deployment.breedingCreate2.salt, initCode]);
      console.log("Manual CREATE2 deployment required:");
      console.log(`  deployer contract: ${deployment.breedingCreate2.deployer}`);
      console.log(`  deployer owner:    ${create2Owner}`);
      console.log(`  calldata:          ${deployCalldata}`);
      throw new Error("OwnedCreate2Deployer owner differs from signer; deploy gateway through owner/multisig.");
    }
  } else {
    const existingHash = ethers.keccak256(existingCode as `0x${string}`);
    if (existingHash.toLowerCase() !== deployment.breedingContractRuntimeCodeHash.toLowerCase()) {
      throw new Error(
        `Existing contract code hash mismatch at ${predictedAddress}: expected ${deployment.breedingContractRuntimeCodeHash}, got ${existingHash}`
      );
    }
  }

  const deployedCode = await ethers.provider.getCode(predictedAddress);
  if (deployedCode === "0x") {
    throw new Error(`Gateway deployment failed: no runtime code at ${predictedAddress}`);
  }
  const deployedHash = ethers.keccak256(deployedCode as `0x${string}`);
  if (deployedHash.toLowerCase() !== deployment.breedingContractRuntimeCodeHash.toLowerCase()) {
    throw new Error(
      `Post-deploy runtime hash mismatch at ${predictedAddress}: expected ${deployment.breedingContractRuntimeCodeHash}, got ${deployedHash}`
    );
  }

  await writeDeployment(network.name, {
    ...deployment,
    breedingContract: predictedAddress,
    breedingContractRuntimeCodeHash: deployment.breedingContractRuntimeCodeHash,
    breedingGateway: {
      owner: gatewayOwner,
      token: tokenAddress,
      initialAuthorizedCaller
    }
  });

  console.log(
    JSON.stringify(
      {
        token: tokenAddress,
        breedingContract: predictedAddress,
        breedingContractRuntimeCodeHash: deployment.breedingContractRuntimeCodeHash,
        breedingCreate2: deployment.breedingCreate2,
        breedingGateway: {
          owner: gatewayOwner,
          token: tokenAddress,
          initialAuthorizedCaller
        }
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
