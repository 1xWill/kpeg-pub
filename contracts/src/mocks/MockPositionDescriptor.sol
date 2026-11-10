// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

contract MockPositionDescriptor is IPositionDescriptor {
    address public immutable wrappedNative;
    IPoolManager public immutable poolManager;
    string private nativeLabel;

    constructor(IPoolManager manager, address wrappedNativeAddress, string memory label) {
        poolManager = manager;
        wrappedNative = wrappedNativeAddress;
        nativeLabel = label;
    }

    function tokenURI(IPositionManager, uint256) external pure returns (string memory) {
        return "";
    }

    function flipRatio(address, address) external pure returns (bool) {
        return false;
    }

    function currencyRatioPriority(address) external pure returns (int256) {
        return 0;
    }

    function nativeCurrencyLabel() external view returns (string memory) {
        return nativeLabel;
    }
}
