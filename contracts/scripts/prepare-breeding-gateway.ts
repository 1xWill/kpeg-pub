import { ethers, network } from "hardhat";
import { assertContractCode, readDeployment, writeDeployment } from "./lib";

type CliArgs = {
  create2Deployer?: string;
  salt?: string;
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
    create2Deployer: argValue("--create2-deployer"),
    salt: argValue("--salt"),
    gatewayOwner: argValue("--gateway-owner"),
    initialAuthorizedCaller: argValue("--initial-authorized-caller")
  };
}

function assertBytes32(value: string, label: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a bytes32 hex string`);
  }
}

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

  const cli = parseArgs();
  const deployment = await readDeployment(network.name);

  const token = await ethers.getContractAt("KPEGToken", deployment.token);
  if (await token.started()) {
    throw new Error("KPEGToken already started; prepare the breeding gateway plan before bootstrap/start.");
  }

  const tokenAddress = deployment.token;
  const gatewayOwner = envOrArg("KPEG_BIRTH_GATEWAY_OWNER", cli.gatewayOwner) ?? deployer.address;
  const initialAuthorizedCaller = envOrArg("KPEG_BIRTH_GATEWAY_INITIAL_AUTHORIZED_CALLER", cli.initialAuthorizedCaller) ?? ethers.ZeroAddress;
  if (!ethers.isAddress(gatewayOwner)) {
    throw new Error(`KPEG_BIRTH_GATEWAY_OWNER must be a valid address: ${gatewayOwner}`);
  }
  if (!ethers.isAddress(initialAuthorizedCaller)) {
    throw new Error(
      `KPEG_BIRTH_GATEWAY_INITIAL_AUTHORIZED_CALLER must be a valid address: ${initialAuthorizedCaller}`
    );
  }

  const salt =
    envOrArg("KPEG_BREEDING_CREATE2_SALT", cli.salt) ??
    deployment.breedingCreate2?.salt;
  if (!salt) {
    throw new Error(
      "Missing salt. Set KPEG_BREEDING_CREATE2_SALT or pass --salt 0x... to lock the gateway CREATE2 address."
    );
  }
  assertBytes32(salt, "KPEG_BREEDING_CREATE2_SALT");

  let create2Deployer =
    envOrArg("KPEG_BREEDING_CREATE2_DEPLOYER_ADDRESS", cli.create2Deployer) ?? deployment.breedingCreate2?.deployer;
  if (create2Deployer) {
    if (!ethers.isAddress(create2Deployer)) {
      throw new Error("KPEG_BREEDING_CREATE2_DEPLOYER_ADDRESS must be a valid address");
    }
    const owner = await getOwnedCreate2DeployerOwner(create2Deployer);
    console.log(`OwnedCreate2Deployer owner: ${owner}`);
  } else {
    const OwnedCreate2Factory = await ethers.getContractFactory("OwnedCreate2Deployer");
    const ownedCreate2 = await OwnedCreate2Factory.deploy(deployer.address);
    await ownedCreate2.waitForDeployment();
    create2Deployer = await ownedCreate2.getAddress();
    console.log(`OwnedCreate2Deployer deployed for breeding: ${create2Deployer}`);
  }

  const GatewayFactory = await ethers.getContractFactory("KPEGBirthGateway");
  const constructorArgs = GatewayFactory.interface.encodeDeploy([gatewayOwner, tokenAddress, initialAuthorizedCaller]);
  const initCode = ethers.concat([GatewayFactory.bytecode as `0x${string}`, constructorArgs as `0x${string}`]);
  const initCodeHash = ethers.keccak256(initCode);
  const derivedRuntimeBytecode = await ethers.provider.call({ from: deployer.address, data: initCode });
  if (derivedRuntimeBytecode === "0x") {
    throw new Error("Failed to derive KPEGBirthGateway runtime bytecode from init code.");
  }
  const runtimeCodeHash = ethers.keccak256(derivedRuntimeBytecode as `0x${string}`);

  const breedingContract = ethers.getCreate2Address(create2Deployer, salt, initCodeHash);
  const existingCode = await ethers.provider.getCode(breedingContract);
  if (existingCode !== "0x") {
    const existingHash = ethers.keccak256(existingCode as `0x${string}`);
    if (existingHash.toLowerCase() !== runtimeCodeHash.toLowerCase()) {
      throw new Error(
        `Existing code hash mismatch at ${breedingContract}: expected ${runtimeCodeHash}, got ${existingHash}`
      );
    }
  }

  await writeDeployment(network.name, {
    ...deployment,
    breedingContract,
    breedingContractRuntimeCodeHash: runtimeCodeHash,
    breedingCreate2: {
      deployer: create2Deployer,
      salt,
      initCodeHash
    },
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
        breedingContract,
        breedingContractRuntimeCodeHash: runtimeCodeHash,
        breedingCreate2: {
          deployer: create2Deployer,
          salt,
          initCodeHash
        },
        breedingGateway: {
          owner: gatewayOwner,
          token: tokenAddress,
          initialAuthorizedCaller
        },
        env: {
          KPEG_BREEDING_CREATE2_DEPLOYER_ADDRESS: create2Deployer,
          KPEG_BREEDING_CREATE2_SALT: salt,
          KPEG_BREEDING_INIT_CODE_HASH: initCodeHash,
          KPEG_BREEDING_RUNTIME_CODE_HASH: runtimeCodeHash
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
