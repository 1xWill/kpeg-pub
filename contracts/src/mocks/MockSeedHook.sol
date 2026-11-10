// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IMockStartableToken {
    function start(address poolManager) external;
}

contract MockSeedHook {
    bytes32 public randomSeed;

    constructor(bytes32 initialSeed) {
        randomSeed = initialSeed;
    }

    function setSeed(bytes32 nextSeed) external {
        randomSeed = nextSeed;
    }

    function startToken(address token, address poolManager) external {
        IMockStartableToken(token).start(poolManager);
    }
}
