import { ethers } from "hardhat";

export function requireMarketFinalConfirmation(value: string | undefined): void {
  if ((value ?? "").trim() !== "1") {
    throw new Error(
      "Set KPEG_CONFIRM_MARKET_FINAL=1 or pass --confirm-market-final 1 to confirm market fee settings are final before renounce."
    );
  }
}

export function assertTokenRenouncePreconditions(input: {
  started: boolean;
  tokenHook: string;
  expectedHook: string;
  deploymentBreedingContract?: string;
  tokenBreedingContract: string;
  deploymentBreedingContractRuntimeCodeHash?: string;
  tokenBreedingContractCodeHash: string;
}): void {
  if (!input.started) {
    throw new Error("Preflight failed: KPEGToken.started() is false. Bootstrap/start before renounce.");
  }
  if (input.tokenHook.toLowerCase() !== input.expectedHook.toLowerCase()) {
    throw new Error(`Preflight failed: token.hook mismatch. expected ${input.expectedHook}`);
  }
  if (!input.deploymentBreedingContract || !ethers.isAddress(input.deploymentBreedingContract)) {
    throw new Error("Preflight failed: deployment.breedingContract missing.");
  }
  if (input.tokenBreedingContract.toLowerCase() !== input.deploymentBreedingContract.toLowerCase()) {
    throw new Error(`Preflight failed: token.breedingContract mismatch. expected ${input.deploymentBreedingContract}`);
  }
  if (!input.deploymentBreedingContractRuntimeCodeHash) {
    throw new Error("Preflight failed: deployment.breedingContractRuntimeCodeHash missing.");
  }
  if (input.tokenBreedingContractCodeHash.toLowerCase() !== input.deploymentBreedingContractRuntimeCodeHash.toLowerCase()) {
    throw new Error(
      `Preflight failed: token.breedingContractCodeHash mismatch. expected ${input.deploymentBreedingContractRuntimeCodeHash}`
    );
  }
}

export function assertRouterRenouncePreconditions(input: {
  poolInitialized: boolean;
  currency0: string;
  currency1: string;
  deploymentToken: string;
  deploymentWeth: string;
  poolHook: string;
  deploymentHook: string;
  poolFee: number;
  deploymentFee: number;
  poolTickSpacing: number;
  deploymentTickSpacing: number;
}): void {
  if (!input.poolInitialized) {
    throw new Error("Preflight failed: router.poolInitialized() is false.");
  }
  const currency0 = input.currency0.toLowerCase();
  const currency1 = input.currency1.toLowerCase();
  const depToken = input.deploymentToken.toLowerCase();
  const depWeth = input.deploymentWeth.toLowerCase();
  if (!((currency0 === depToken && currency1 === depWeth) || (currency0 === depWeth && currency1 === depToken))) {
    throw new Error("Preflight failed: router pool key token/WETH mismatch.");
  }
  if (input.poolHook.toLowerCase() !== input.deploymentHook.toLowerCase()) {
    throw new Error(`Preflight failed: router pool key hook mismatch. expected ${input.deploymentHook}`);
  }
  if (input.poolFee !== input.deploymentFee) {
    throw new Error(`Preflight failed: router fee mismatch. expected ${input.deploymentFee}`);
  }
  if (input.poolTickSpacing !== input.deploymentTickSpacing) {
    throw new Error(`Preflight failed: router tick spacing mismatch. expected ${input.deploymentTickSpacing}`);
  }
}

export function assertGatewayRenouncePreconditions(input: {
  gatewaySelected: boolean;
  gatewayPresent: boolean;
  authorizationsFrozen: boolean;
  engineAddress?: string;
  engineAuthorized: boolean;
}): void {
  if (!input.gatewaySelected) {
    return;
  }
  if (!input.gatewayPresent) {
    throw new Error("Gateway target selected but deployment.breedingContract is missing.");
  }
  if (!input.authorizationsFrozen) {
    throw new Error("Preflight failed: gateway authorizations are not frozen.");
  }
  if (!input.engineAddress || !ethers.isAddress(input.engineAddress)) {
    throw new Error("Preflight failed: breeding engine address missing for gateway verification.");
  }
  if (!input.engineAuthorized) {
    throw new Error(`Preflight failed: gateway does not authorize breeding engine ${input.engineAddress}.`);
  }
}
