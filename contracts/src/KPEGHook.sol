// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";

interface IKPEGLifecycleToken {
    function start(address poolManager) external;
    function started() external view returns (bool);
}

contract KPEGHook is BaseHook {
    using BalanceDeltaLibrary for BalanceDelta;

    error OnlyOwner();
    error ZeroOwner();
    error ZeroToken();

    address public owner;
    IKPEGLifecycleToken public token;
    bytes32 public randomSeed;
    uint256 public randomCount;

    event TokenSet(address indexed token);
    event OwnershipRenounced(address indexed previousOwner);
    event RandomnessUpdated(bytes32 indexed randomSeed, uint256 indexed randomCount, address indexed caller);
    event TokenStarted(address indexed token, address indexed poolManager);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(IPoolManager manager, address initialOwner) BaseHook(manager) {
        if (initialOwner == address(0)) revert ZeroOwner();
        owner = initialOwner;
        randomSeed = keccak256(abi.encodePacked(block.timestamp, block.prevrandao, block.chainid, initialOwner));
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: true,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function setToken(address newToken) external onlyOwner {
        if (newToken == address(0)) revert ZeroToken();
        token = IKPEGLifecycleToken(newToken);
        emit TokenSet(newToken);
    }

    function renounceOwnership() external onlyOwner {
        address previousOwner = owner;
        owner = address(0);
        emit OwnershipRenounced(previousOwner);
    }

    function _afterAddLiquidity(
        address,
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) internal override returns (bytes4, BalanceDelta) {
        if (address(token) != address(0) && _poolContainsToken(key) && !token.started()) {
            token.start(address(poolManager));
            emit TokenStarted(address(token), address(poolManager));
        }
        return (BaseHook.afterAddLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        if (_poolContainsToken(key)) {
            randomCount += 1;
            randomSeed = keccak256(
                abi.encodePacked(randomSeed, randomCount, sender, block.timestamp, block.prevrandao, block.number)
            );
            emit RandomnessUpdated(randomSeed, randomCount, sender);
        }
        return (BaseHook.afterSwap.selector, 0);
    }

    function _poolContainsToken(PoolKey calldata key) internal view returns (bool) {
        address currentToken = address(token);
        return
            currentToken != address(0) &&
            (Currency.unwrap(key.currency0) == currentToken || Currency.unwrap(key.currency1) == currentToken);
    }
}
