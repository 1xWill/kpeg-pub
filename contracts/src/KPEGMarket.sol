// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IKPEGMarketToken {
    function ownsKitties(address account, uint256[] calldata kittyIds) external view returns (bool);
    function directTransferKittiesList(address to, uint256[] calldata kittyIds) external returns (bool);
    function directTransferKittiesListFrom(address from, address to, uint256[] calldata kittyIds) external returns (bool);
}

contract KPEGMarket {
    error AlreadyDeleted();
    error AlreadySold();
    error BuyerIsSeller();
    error KittyListNotSorted();
    error DuplicateKitty();
    error EmptyKittyList();
    error MaxBundleSizeExceeded();
    error ExpectedPaymentTokenMismatch();
    error InsufficientEth();
    error InvalidFeeAddress();
    error MaxFeeExceeded();
    error MaxPriceExceeded();
    error NotSeller();
    error OnlyOwner();
    error PaymentTokenUnsupported();
    error ReentrantCall();
    error ListingNotReady();
    error ZeroAddress();
    error ZeroPrice();

    enum PositionStatus {
        OPEN,
        SOLD,
        DELETED
    }

    struct Position {
        address seller;
        address buyer;
        address escrowAddress;
        address paymentToken;
        uint256 price;
        uint256 feeBps;
        uint256[] kittyIds;
        PositionStatus status;
    }

    struct PositionView {
        uint256 tradeId;
        address seller;
        address buyer;
        address escrowAddress;
        address paymentToken;
        uint256 price;
        uint256 feeBps;
        uint256[] kittyIds;
        PositionStatus status;
        bool ready;
    }

    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant MAX_FEE_BPS = 500;
    uint256 public constant MAX_BUNDLE_SIZE = 100;
    uint256 public constant MAX_PAGE_SIZE = 100;

    address public owner;
    address public immutable token;
    address public feeRecipient;
    uint256 public feeBps = 200;
    uint256 public positionsTotal;

    mapping(uint256 => Position) private positions;
    bool private locked;

    event PositionCreated(
        uint256 indexed tradeId,
        address indexed seller,
        address indexed escrowAddress,
        address paymentToken,
        uint256 price,
        uint256[] kittyIds,
        uint256 feeBps
    );
    event PositionDeleted(uint256 indexed tradeId, address indexed seller);
    event PositionBought(
        uint256 indexed tradeId,
        address indexed buyer,
        address indexed seller,
        uint256 price,
        uint256 feeAmount
    );
    event PositionParamsSet(uint256 indexed tradeId, address indexed paymentToken, uint256 price);
    event OwnershipRenounced(address indexed previousOwner);
    event FeeAddressUpdated(address indexed feeAddress);
    event FeeShareUpdated(uint256 feeBps);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked) revert ReentrantCall();
        locked = true;
        _;
        locked = false;
    }

    constructor(address token_, address feeRecipient_) {
        if (token_ == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        token = token_;
        feeRecipient = feeRecipient_;
    }

    function createTradeAndFund(address paymentToken, uint256 price, uint256[] calldata kittyIds)
        external
        nonReentrant
        returns (uint256 tradeId, address escrowAddress)
    {
        if (paymentToken != address(0)) revert PaymentTokenUnsupported();
        if (price == 0) revert ZeroPrice();
        _validateKittyIds(kittyIds);

        tradeId = positionsTotal + 1;
        positionsTotal = tradeId;

        escrowAddress = address(this);

        Position storage stored = positions[tradeId];
        stored.seller = msg.sender;
        stored.escrowAddress = escrowAddress;
        stored.paymentToken = paymentToken;
        stored.price = price;
        stored.feeBps = feeBps;
        stored.status = PositionStatus.OPEN;
        for (uint256 i = 0; i < kittyIds.length; i += 1) {
            stored.kittyIds.push(kittyIds[i]);
        }

        emit PositionCreated(tradeId, msg.sender, escrowAddress, paymentToken, price, kittyIds, feeBps);

        IKPEGMarketToken(token).directTransferKittiesListFrom(msg.sender, escrowAddress, kittyIds);
        if (!_isReady(stored)) revert ListingNotReady();
    }

    function setPositionParams(uint256 tradeId, address paymentToken, uint256 price) external {
        Position storage position = _existingPosition(tradeId);
        if (position.status == PositionStatus.SOLD) revert AlreadySold();
        if (position.status == PositionStatus.DELETED) revert AlreadyDeleted();
        if (position.seller != msg.sender) revert NotSeller();
        if (paymentToken != address(0)) revert PaymentTokenUnsupported();
        if (price == 0) revert ZeroPrice();

        position.paymentToken = paymentToken;
        position.price = price;
        emit PositionParamsSet(tradeId, paymentToken, price);
    }

    function deletePosition(uint256 tradeId) external nonReentrant {
        Position storage position = _existingPosition(tradeId);
        if (position.status == PositionStatus.SOLD) revert AlreadySold();
        if (position.status == PositionStatus.DELETED) revert AlreadyDeleted();
        if (position.seller != msg.sender) revert NotSeller();

        position.status = PositionStatus.DELETED;
        if (_isReady(position)) {
            IKPEGMarketToken(token).directTransferKittiesList(position.seller, position.kittyIds);
        }
        emit PositionDeleted(tradeId, position.seller);
    }

    function buyAndClaimAll(uint256 tradeId, address expectedPaymentToken, uint256 maxPrice)
        external
        payable
        nonReentrant
    {
        Position storage position = _existingPosition(tradeId);
        if (position.status == PositionStatus.SOLD) revert AlreadySold();
        if (position.status == PositionStatus.DELETED) revert AlreadyDeleted();
        if (position.seller == msg.sender) revert BuyerIsSeller();
        if (expectedPaymentToken != position.paymentToken) revert ExpectedPaymentTokenMismatch();
        if (position.price > maxPrice) revert MaxPriceExceeded();
        if (msg.value < position.price) revert InsufficientEth();

        position.status = PositionStatus.SOLD;
        position.buyer = msg.sender;

        IKPEGMarketToken(token).directTransferKittiesList(msg.sender, position.kittyIds);

        uint256 feeAmount = (position.price * position.feeBps) / FEE_DENOMINATOR;
        uint256 sellerAmount = position.price - feeAmount;
        _safeTransferEth(position.seller, sellerAmount);
        if (feeAmount > 0) {
            _safeTransferEth(feeRecipient, feeAmount);
        }
        if (msg.value > position.price) {
            _safeTransferEth(msg.sender, msg.value - position.price);
        }

        emit PositionBought(tradeId, msg.sender, position.seller, position.price, feeAmount);
    }

    function setFeeAddress(address newFeeRecipient) external onlyOwner {
        if (newFeeRecipient == address(0)) revert InvalidFeeAddress();
        feeRecipient = newFeeRecipient;
        emit FeeAddressUpdated(newFeeRecipient);
    }

    function setFeeShare(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert MaxFeeExceeded();
        feeBps = newFeeBps;
        emit FeeShareUpdated(newFeeBps);
    }

    function renounceOwnership() external onlyOwner {
        address previousOwner = owner;
        owner = address(0);
        emit OwnershipRenounced(previousOwner);
    }

    function getPosition(uint256 tradeId) external view returns (Position memory) {
        return _existingPositionView(tradeId);
    }

    function getPositionView(uint256 tradeId) public view returns (PositionView memory) {
        Position storage position = _existingPositionView(tradeId);
        bool ready = _isReady(position);
        return PositionView({
            tradeId: tradeId,
            seller: position.seller,
            buyer: position.buyer,
            escrowAddress: position.escrowAddress,
            paymentToken: position.paymentToken,
            price: position.price,
            feeBps: position.feeBps,
            kittyIds: position.kittyIds,
            status: position.status,
            ready: ready
        });
    }

    function getOpenPositions(uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        uint256 boundedLimit = _boundedLimit(limit);
        uint256 count = 0;
        uint256 skipped = 0;
        for (uint256 i = 1; i <= positionsTotal; i += 1) {
            Position storage position = positions[i];
            if (position.status == PositionStatus.OPEN) {
                if (skipped < offset) {
                    skipped += 1;
                    continue;
                }
                count += 1;
                if (count == boundedLimit) {
                    break;
                }
            }
        }
        uint256[] memory ids = new uint256[](count);
        uint256 cursor = 0;
        skipped = 0;
        for (uint256 i = 1; i <= positionsTotal; i += 1) {
            Position storage position = positions[i];
            if (position.status == PositionStatus.OPEN) {
                if (skipped < offset) {
                    skipped += 1;
                    continue;
                }
                ids[cursor] = i;
                cursor += 1;
                if (cursor == count) {
                    break;
                }
            }
        }
        return ids;
    }

    function getOpenPositionsByOwner(address account, uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        uint256 boundedLimit = _boundedLimit(limit);
        uint256 count = 0;
        uint256 skipped = 0;
        for (uint256 i = 1; i <= positionsTotal; i += 1) {
            Position storage position = positions[i];
            if (position.seller == account && position.status == PositionStatus.OPEN) {
                if (skipped < offset) {
                    skipped += 1;
                    continue;
                }
                count += 1;
                if (count == boundedLimit) {
                    break;
                }
            }
        }
        uint256[] memory ids = new uint256[](count);
        uint256 cursor = 0;
        skipped = 0;
        for (uint256 i = 1; i <= positionsTotal; i += 1) {
            Position storage position = positions[i];
            if (position.seller == account && position.status == PositionStatus.OPEN) {
                if (skipped < offset) {
                    skipped += 1;
                    continue;
                }
                ids[cursor] = i;
                cursor += 1;
                if (cursor == count) {
                    break;
                }
            }
        }
        return ids;
    }

    function getPurchasedPositions(address account, uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        uint256 boundedLimit = _boundedLimit(limit);
        uint256 count = 0;
        uint256 skipped = 0;
        for (uint256 i = 1; i <= positionsTotal; i += 1) {
            if (positions[i].buyer == account) {
                if (skipped < offset) {
                    skipped += 1;
                    continue;
                }
                count += 1;
                if (count == boundedLimit) {
                    break;
                }
            }
        }
        uint256[] memory ids = new uint256[](count);
        uint256 cursor = 0;
        skipped = 0;
        for (uint256 i = 1; i <= positionsTotal; i += 1) {
            if (positions[i].buyer == account) {
                if (skipped < offset) {
                    skipped += 1;
                    continue;
                }
                ids[cursor] = i;
                cursor += 1;
                if (cursor == count) {
                    break;
                }
            }
        }
        return ids;
    }

    function getCompletedPositions(address account, uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        uint256 boundedLimit = _boundedLimit(limit);
        uint256 count = 0;
        uint256 skipped = 0;
        for (uint256 i = 1; i <= positionsTotal; i += 1) {
            Position storage position = positions[i];
            if (position.seller == account && position.status == PositionStatus.SOLD) {
                if (skipped < offset) {
                    skipped += 1;
                    continue;
                }
                count += 1;
                if (count == boundedLimit) {
                    break;
                }
            }
        }
        uint256[] memory ids = new uint256[](count);
        uint256 cursor = 0;
        skipped = 0;
        for (uint256 i = 1; i <= positionsTotal; i += 1) {
            Position storage position = positions[i];
            if (position.seller == account && position.status == PositionStatus.SOLD) {
                if (skipped < offset) {
                    skipped += 1;
                    continue;
                }
                ids[cursor] = i;
                cursor += 1;
                if (cursor == count) {
                    break;
                }
            }
        }
        return ids;
    }

    function isPositionReady(uint256 tradeId) public view returns (bool) {
        return _isReady(_existingPositionView(tradeId));
    }

    function _validateKittyIds(uint256[] calldata kittyIds) private pure {
        if (kittyIds.length == 0) revert EmptyKittyList();
        if (kittyIds.length > MAX_BUNDLE_SIZE) revert MaxBundleSizeExceeded();
        for (uint256 i = 1; i < kittyIds.length; i += 1) {
            if (kittyIds[i] == kittyIds[i - 1]) revert DuplicateKitty();
            if (kittyIds[i] < kittyIds[i - 1]) revert KittyListNotSorted();
        }
    }

    function _boundedLimit(uint256 limit) private pure returns (uint256) {
        if (limit == 0) {
            return MAX_PAGE_SIZE;
        }
        return limit > MAX_PAGE_SIZE ? MAX_PAGE_SIZE : limit;
    }

    function _isReady(Position storage position) private view returns (bool) {
        return IKPEGMarketToken(token).ownsKitties(position.escrowAddress, position.kittyIds);
    }

    function _existingPosition(uint256 tradeId) private view returns (Position storage position) {
        position = positions[tradeId];
        if (position.seller == address(0)) revert ZeroAddress();
    }

    function _existingPositionView(uint256 tradeId) private view returns (Position storage position) {
        position = positions[tradeId];
        if (position.seller == address(0)) revert ZeroAddress();
    }

    function _safeTransferEth(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert InsufficientEth();
    }
}
