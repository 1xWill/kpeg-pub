// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";

interface IWETHLike is IERC20Minimal {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

contract KPEGV4Router is IUnlockCallback {
    using BalanceDeltaLibrary for BalanceDelta;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    error AlreadyInitialized();
    error DeadlineExpired();
    error NotManager();
    error OnlyOwner();
    error PoolNotInitialized();
    error SlippageExceeded();
    error UnsupportedEtherSender();

    enum Action {
        BuyExactOutput,
        SellExactInput
    }

    struct CallbackData {
        Action action;
        address payer;
        address recipient;
        uint256 amountSpecified;
        uint256 amountTokenLimit;
        uint256 amountWethLimit;
        uint160 sqrtPriceLimitX96;
        bytes hookData;
    }

    struct CallbackResult {
        uint256 tokenAmount;
        uint256 wethAmount;
    }

    address public owner;
    IPoolManager public immutable manager;
    address public immutable token;
    IWETHLike public immutable weth;
    IHooks public immutable hook;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;
    bool public immutable tokenIsCurrency0;

    event Bought(address indexed buyer, address indexed recipient, uint256 wethIn, uint256 kpegOut);
    event OwnershipRenounced(address indexed previousOwner);
    event PoolInitialized(uint160 sqrtPriceX96);
    event Sold(address indexed seller, address indexed recipient, uint256 kpegIn, uint256 wethOut);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier ensureDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        _;
    }

    constructor(
        IPoolManager poolManager,
        address initialOwner,
        address tokenAddress,
        address wethAddress,
        address hookAddress,
        uint24 feeAmount,
        int24 tickSpacingAmount
    ) {
        owner = initialOwner;
        manager = poolManager;
        token = tokenAddress;
        weth = IWETHLike(wethAddress);
        hook = IHooks(hookAddress);
        fee = feeAmount;
        tickSpacing = tickSpacingAmount;
        tokenIsCurrency0 = tokenAddress < wethAddress;
    }

    receive() external payable {
        if (msg.sender != address(weth)) revert UnsupportedEtherSender();
    }

    function getPoolKey() public view returns (PoolKey memory key) {
        Currency currencyToken = Currency.wrap(token);
        Currency currencyWeth = Currency.wrap(address(weth));

        if (tokenIsCurrency0) {
            key = PoolKey({
                currency0: currencyToken,
                currency1: currencyWeth,
                fee: fee,
                tickSpacing: tickSpacing,
                hooks: hook
            });
        } else {
            key = PoolKey({
                currency0: currencyWeth,
                currency1: currencyToken,
                fee: fee,
                tickSpacing: tickSpacing,
                hooks: hook
            });
        }
    }

    function poolInitialized() public view returns (bool) {
        return _isPoolInitialized();
    }

    function initializePool(uint160 sqrtPriceX96) external onlyOwner returns (int24 tick) {
        if (_isPoolInitialized()) revert AlreadyInitialized();
        tick = manager.initialize(getPoolKey(), sqrtPriceX96);
        emit PoolInitialized(sqrtPriceX96);
    }

    function renounceOwnership() external onlyOwner {
        address previousOwner = owner;
        owner = address(0);
        emit OwnershipRenounced(previousOwner);
    }

    function buyExactKPEG(
        uint256 exactKPEGOut,
        address recipient,
        uint256 deadline,
        uint160 sqrtPriceLimitX96,
        bytes calldata hookData
    ) external payable ensureDeadline(deadline) returns (uint256 ethUsed) {
        if (!_isPoolInitialized()) revert PoolNotInitialized();

        weth.deposit{value: msg.value}();

        bytes memory result = manager.unlock(
            abi.encode(
                CallbackData({
                    action: Action.BuyExactOutput,
                    payer: address(this),
                    recipient: recipient,
                    amountSpecified: exactKPEGOut,
                    amountTokenLimit: exactKPEGOut,
                    amountWethLimit: msg.value,
                    sqrtPriceLimitX96: sqrtPriceLimitX96,
                    hookData: hookData
                })
            )
        );

        CallbackResult memory decoded = abi.decode(result, (CallbackResult));
        ethUsed = decoded.wethAmount;

        _refundWeth(payable(msg.sender));
        emit Bought(msg.sender, recipient, ethUsed, decoded.tokenAmount);
    }

    function sellExactKPEG(
        uint256 amountIn,
        uint256 minEthOut,
        address recipient,
        uint256 deadline,
        uint160 sqrtPriceLimitX96,
        bytes calldata hookData
    ) external ensureDeadline(deadline) returns (uint256 ethOut) {
        if (!_isPoolInitialized()) revert PoolNotInitialized();

        bytes memory result = manager.unlock(
            abi.encode(
                CallbackData({
                    action: Action.SellExactInput,
                    payer: msg.sender,
                    recipient: recipient,
                    amountSpecified: amountIn,
                    amountTokenLimit: amountIn,
                    amountWethLimit: minEthOut,
                    sqrtPriceLimitX96: sqrtPriceLimitX96,
                    hookData: hookData
                })
            )
        );

        CallbackResult memory decoded = abi.decode(result, (CallbackResult));
        ethOut = decoded.wethAmount;

        _withdrawAndSendEth(payable(recipient), ethOut);
        emit Sold(msg.sender, recipient, amountIn, ethOut);
    }

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert NotManager();

        CallbackData memory data = abi.decode(rawData, (CallbackData));
        if (data.action == Action.BuyExactOutput) {
            return _handleBuyExactOutput(data);
        }
        return _handleSellExactInput(data);
    }

    function _handleBuyExactOutput(CallbackData memory data) internal returns (bytes memory) {
        PoolKey memory key = getPoolKey();

        BalanceDelta delta = manager.swap(
            key,
            SwapParams({
                zeroForOne: _wethIsCurrency0(),
                amountSpecified: int256(data.amountSpecified),
                sqrtPriceLimitX96: _swapLimit(_wethIsCurrency0(), data.sqrtPriceLimitX96)
            }),
            data.hookData
        );

        uint256 wethIn = _negativeAmountForWeth(delta);
        uint256 tokenOut = _positiveAmountForToken(delta);
        if (wethIn > data.amountWethLimit || tokenOut != data.amountSpecified) revert SlippageExceeded();

        _settleDeltas(key, data, delta);
        manager.take(_tokenCurrency(), data.recipient, tokenOut);

        return abi.encode(CallbackResult({tokenAmount: tokenOut, wethAmount: wethIn}));
    }

    function _handleSellExactInput(CallbackData memory data) internal returns (bytes memory) {
        PoolKey memory key = getPoolKey();
        BalanceDelta delta = manager.swap(
            key,
            SwapParams({
                zeroForOne: _tokenIsCurrency0(),
                amountSpecified: -int256(data.amountSpecified),
                sqrtPriceLimitX96: _swapLimit(_tokenIsCurrency0(), data.sqrtPriceLimitX96)
            }),
            data.hookData
        );

        uint256 tokenIn = _negativeAmountForToken(delta);
        uint256 wethOut = _positiveAmountForWeth(delta);
        if (tokenIn > data.amountTokenLimit || wethOut < data.amountWethLimit) revert SlippageExceeded();

        _settleDeltas(key, data, delta);
        manager.take(_wethCurrency(), address(this), wethOut);

        return abi.encode(CallbackResult({tokenAmount: tokenIn, wethAmount: wethOut}));
    }

    function _settleDeltas(PoolKey memory key, CallbackData memory data, BalanceDelta delta) internal {
        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();

        if (amount0 < 0) {
            _settleCurrency(key.currency0, _payerForCurrency(key.currency0, data), uint256(uint128(-amount0)));
        }
        if (amount1 < 0) {
            _settleCurrency(key.currency1, _payerForCurrency(key.currency1, data), uint256(uint128(-amount1)));
        }
    }

    function _payerForCurrency(Currency, CallbackData memory data) internal pure returns (address) {
        return data.payer;
    }

    function _settleCurrency(Currency currency, address payer, uint256 amount) internal {
        if (amount == 0) {
            return;
        }

        manager.sync(currency);
        address currencyAddress = Currency.unwrap(currency);
        if (payer == address(this)) {
            IERC20Minimal(currencyAddress).transfer(address(manager), amount);
        } else {
            IERC20Minimal(currencyAddress).transferFrom(payer, address(manager), amount);
        }
        manager.settle();
    }

    function _refundWeth(address payable recipient) internal {
        uint256 refund = weth.balanceOf(address(this));
        if (refund == 0) {
            return;
        }
        weth.withdraw(refund);
        (bool ok,) = recipient.call{value: refund}("");
        require(ok, "ETH_REFUND_FAILED");
    }

    function _withdrawAndSendEth(address payable recipient, uint256 amount) internal {
        if (amount == 0) {
            return;
        }
        weth.withdraw(amount);
        (bool ok,) = recipient.call{value: amount}("");
        require(ok, "ETH_SEND_FAILED");
    }

    function _tokenCurrency() internal view returns (Currency) {
        return Currency.wrap(token);
    }

    function _wethCurrency() internal view returns (Currency) {
        return Currency.wrap(address(weth));
    }

    function _tokenIsCurrency0() internal view returns (bool) {
        return tokenIsCurrency0;
    }

    function _wethIsCurrency0() internal view returns (bool) {
        return !tokenIsCurrency0;
    }

    function _positiveAmountForToken(BalanceDelta delta) internal view returns (uint256) {
        return _tokenIsCurrency0() ? _positive(delta.amount0()) : _positive(delta.amount1());
    }

    function _positiveAmountForWeth(BalanceDelta delta) internal view returns (uint256) {
        return _wethIsCurrency0() ? _positive(delta.amount0()) : _positive(delta.amount1());
    }

    function _negativeAmountForToken(BalanceDelta delta) internal view returns (uint256) {
        return _negative(_tokenIsCurrency0() ? delta.amount0() : delta.amount1());
    }

    function _negativeAmountForWeth(BalanceDelta delta) internal view returns (uint256) {
        return _negative(_wethIsCurrency0() ? delta.amount0() : delta.amount1());
    }

    function _positive(int128 value) internal pure returns (uint256) {
        return value > 0 ? uint256(uint128(value)) : 0;
    }

    function _negative(int128 value) internal pure returns (uint256) {
        return value < 0 ? uint256(uint128(-value)) : 0;
    }

    function _swapLimit(bool zeroForOne, uint160 customLimit) internal pure returns (uint160) {
        if (customLimit != 0) {
            return customLimit;
        }
        return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
    }

    function _isPoolInitialized() internal view returns (bool) {
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(getPoolKey().toId());
        return sqrtPriceX96 != 0;
    }
}
