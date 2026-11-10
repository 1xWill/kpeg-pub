// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {V4Quoter} from "@uniswap/v4-periphery/src/lens/V4Quoter.sol";

contract KPEGV4Quoter is V4Quoter {
    constructor(IPoolManager poolManager) V4Quoter(poolManager) {}
}
