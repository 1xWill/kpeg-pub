// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IKPEGEntropySource {
    function randomSeed() external view returns (bytes32);
}

interface IKPEGRenderer {
    struct KittyTraitNames {
        string background;
        string breed;
        string clothes;
        string mood;
        string marks;
        string mouth;
        string eyes;
        string accessory;
    }

    function generateTraits(uint256 kittyId, uint8 tier, bytes32 seed) external view returns (uint256);
    function kittySvg(uint256 packedTraits, uint8 tier) external view returns (string memory);
    function kittyTraits(uint256 packedTraits) external view returns (KittyTraitNames memory);
    function tokenUriJson(uint256 kittyId, uint8 tier, uint256 packedTraits) external view returns (string memory);
}

contract KPEGToken {
    error AllowanceExceeded();
    error AlreadyStarted();
    error BalanceTooLow();
    error BreedingContractAlreadySet();
    error BreedingContractCodeHashMismatch();
    error BuyLimitExceeded();
    error KittyListNotSorted();
    error KittyDead();
    error CannotReceiveKitty();
    error DuplicateKitty();
    error InvalidBornTraits();
    error NotKittyOperator();
    error EmptyKittyList();
    error NotKittyOwner();
    error OnlyBreedingContract();
    error OnlyHook();
    error OnlyOwner();
    error StartedNotConfigured();
    error TokenNotStarted();
    error ZeroBreedingContract();
    error ZeroBreedingContractCodeHash();
    error ZeroAddress();
    error ZeroHook();
    error ZeroOwner();
    error ZeroRenderer();

    string public constant name = "kPEG";
    string public constant symbol = "kPEG";
    uint8 public constant decimals = 18;
    uint256 public constant TOKEN_SUPPLY_FIXED = 9_999 ether;
    uint256 public constant KITTY_UNIT = 1 ether;
    uint8 private constant BACKGROUND_COUNT = 6;
    uint8 private constant BREED_COUNT = 20;
    uint8 private constant CLOTHES_COUNT = 18;
    uint8 private constant MOOD_COUNT = 12;
    uint8 private constant MARK_COUNT = 4;
    uint8 private constant MOUTH_COUNT = 12;
    uint8 private constant EYE_COUNT = 12;
    uint8 private constant ACCESSORY_COUNT = 17;

    uint256 private constant MAX_BUY_PRECISION = 100_000;
    uint256 private constant START_MAX_BUY_COUNT = (TOKEN_SUPPLY_FIXED * 250) / MAX_BUY_PRECISION;
    uint256 private constant ADD_MAX_BUY_PERCENT_PER_SEC = 3;

    address public owner;
    address public immutable notMintableAccount;
    address public immutable renderer;
    address public breedingContract;
    bytes32 public breedingContractCodeHash;
    address public hook;
    address public poolManager;
    bool public started;
    uint256 public startedAt;
    uint256 public kittiesLive;
    uint256 public kittiesEverMinted;

    struct Kitty {
        uint256 id;
        address owner;
        uint8 tier;
        bytes32 seed;
        uint256 traits;
        bool alive;
    }

    struct KittyBatch {
        uint256 startId;
        uint256 count;
        uint256 batchSizeWhole;
        uint8 tier;
        bytes32 seedBase;
    }

    struct LiveRange {
        uint256 startId;
        uint256 count;
        address owner;
    }

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => mapping(address => bool)) public kittyOperatorApproved;
    mapping(address => uint64) private kittyTransferApprovalEpoch;
    mapping(address => mapping(address => mapping(uint256 => uint64))) private kittyTransferApprovedAtEpoch;
    mapping(address => uint256) private ownerKittyCount;
    mapping(uint256 => uint256) private bornTraitOverrides;
    mapping(uint256 => bool) private hasBornTraitOverride;

    KittyBatch[] private kittyBatches;
    LiveRange[] private liveRanges;

    bool private syncPaused;

    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event KittyBatchBurned(address indexed owner, uint256 indexed startKittyId, uint256 count);
    event KittyBatchMinted(
        address indexed owner,
        uint256 indexed startKittyId,
        uint256 count,
        uint8 tier,
        uint256 batchSizeWhole,
        bytes32 seedBase
    );
    event KittyBatchMoved(address indexed from, address indexed to, uint256 indexed startKittyId, uint256 count);
    event KittyMoved(uint256 indexed kittyId, address indexed from, address indexed to);
    event KittyOperatorApproval(address indexed owner, address indexed operator, bool approved);
    event KittyTransferApproval(address indexed owner, address indexed operator, uint256 indexed kittyId, bool approved);
    event KittyTransferApprovalBatch(address indexed owner, address indexed operator, uint256 count, bool approved);
    event HookSet(address indexed hook);
    event OwnershipRenounced(address indexed previousOwner);
    event BreedingContractSet(address indexed breedingContract, bytes32 indexed codeHash);
    event BornKPEGMinted(address indexed owner, uint256 indexed kittyId, uint8 tier, bytes32 seedSalt, uint256 packedTraits);
    event TokenStarted(address indexed poolManager, uint256 timestamp);
    event Transfer(address indexed from, address indexed to, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyHook() {
        if (msg.sender != hook) revert OnlyHook();
        _;
    }

    modifier onlyBreedingContract() {
        if (msg.sender != breedingContract) revert OnlyBreedingContract();
        if (msg.sender.codehash != breedingContractCodeHash) revert BreedingContractCodeHashMismatch();
        _;
    }

    constructor(address initialOwner, address immutableRenderer) {
        if (initialOwner == address(0)) revert ZeroOwner();
        if (immutableRenderer == address(0)) revert ZeroRenderer();
        owner = initialOwner;
        notMintableAccount = initialOwner;
        renderer = immutableRenderer;
        balanceOf[initialOwner] = TOKEN_SUPPLY_FIXED;
        emit Transfer(address(0), initialOwner, TOKEN_SUPPLY_FIXED);
    }

    function totalSupply() external pure returns (uint256) {
        return TOKEN_SUPPLY_FIXED;
    }

    function maxBuy() public view returns (uint256) {
        if (!started) {
            return 0;
        }

        uint256 grown =
            START_MAX_BUY_COUNT + ((TOKEN_SUPPLY_FIXED * (block.timestamp - startedAt) * ADD_MAX_BUY_PERCENT_PER_SEC) / MAX_BUY_PRECISION);
        return grown > TOKEN_SUPPLY_FIXED ? TOKEN_SUPPLY_FIXED : grown;
    }

    function setHook(address newHook) external onlyOwner {
        if (newHook == address(0)) revert ZeroHook();
        if (started) revert AlreadyStarted();
        hook = newHook;
        emit HookSet(newHook);
    }

    function renounceOwnership() external onlyOwner {
        address previousOwner = owner;
        owner = address(0);
        emit OwnershipRenounced(previousOwner);
    }

    function setBreedingContract(address newBreedingContract, bytes32 expectedCodeHash) external onlyOwner {
        if (newBreedingContract == address(0)) revert ZeroBreedingContract();
        if (expectedCodeHash == bytes32(0)) revert ZeroBreedingContractCodeHash();
        if (started) revert AlreadyStarted();
        if (breedingContract != address(0)) revert BreedingContractAlreadySet();
        if (newBreedingContract.code.length > 0 && newBreedingContract.codehash != expectedCodeHash) {
            revert BreedingContractCodeHashMismatch();
        }
        breedingContract = newBreedingContract;
        breedingContractCodeHash = expectedCodeHash;
        emit BreedingContractSet(newBreedingContract, expectedCodeHash);
    }

    function start(address newPoolManager) external onlyHook {
        if (newPoolManager == address(0)) revert ZeroAddress();
        if (started) return;
        started = true;
        poolManager = newPoolManager;
        startedAt = block.timestamp;
        emit TokenStarted(newPoolManager, block.timestamp);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert AllowanceExceeded();
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function setKittyOperator(address operator, bool approved) external returns (bool) {
        if (operator == address(0)) revert ZeroAddress();
        kittyOperatorApproved[msg.sender][operator] = approved;
        emit KittyOperatorApproval(msg.sender, operator, approved);
        return true;
    }

    function setKittyTransferApproval(address operator, uint256[] calldata kittyIds, bool approved) external returns (bool) {
        if (operator == address(0)) revert ZeroAddress();
        uint256 length = kittyIds.length;
        if (length == 0) revert EmptyKittyList();
        uint64 approvalEpoch = kittyTransferApprovalEpoch[msg.sender] + 1;

        uint256 previous = 0;
        for (uint256 i = 0; i < length; i += 1) {
            uint256 kittyId = kittyIds[i];
            if (i > 0) {
                if (kittyId == previous) revert DuplicateKitty();
                if (kittyId < previous) revert KittyListNotSorted();
            }
            if (_kittyOwner(kittyId) != msg.sender) revert NotKittyOwner();
            if (approved) {
                kittyTransferApprovedAtEpoch[msg.sender][operator][kittyId] = approvalEpoch;
            } else {
                delete kittyTransferApprovedAtEpoch[msg.sender][operator][kittyId];
            }
            emit KittyTransferApproval(msg.sender, operator, kittyId, approved);
            previous = kittyId;
        }

        emit KittyTransferApprovalBatch(msg.sender, operator, length, approved);
        return true;
    }

    function kittyTransferApprovedFor(address owner_, address operator, uint256 kittyId) external view returns (bool) {
        return _isKittyTransferApproved(owner_, operator, kittyId);
    }

    function kittiesTransferApprovedFor(address owner_, address operator, uint256[] calldata kittyIds)
        external
        view
        returns (bool)
    {
        uint256 length = kittyIds.length;
        if (length == 0) return false;
        for (uint256 i = 0; i < length; i += 1) {
            if (!_isKittyTransferApproved(owner_, operator, kittyIds[i])) {
                return false;
            }
        }
        return true;
    }

    function kitties(uint256 kittyId)
        external
        view
        returns (uint256 id, address owner_, uint8 tier, bytes32 seed, uint256 traits, bool alive)
    {
        Kitty memory kitty = _kittyView(kittyId);
        return (kitty.id, kitty.owner, kitty.tier, kitty.seed, kitty.traits, kitty.alive);
    }

    function getKitty(uint256 kittyId) external view returns (Kitty memory) {
        return _kittyView(kittyId);
    }

    function ownsKitties(address account, uint256[] calldata kittyIds) external view returns (bool) {
        for (uint256 i = 0; i < kittyIds.length; i += 1) {
            if (_kittyOwner(kittyIds[i]) != account) {
                return false;
            }
        }
        return true;
    }

    function kittySvg(uint256 kittyId) external view returns (string memory) {
        Kitty memory kitty = _kittyView(kittyId);
        if (!kitty.alive) revert KittyDead();
        return IKPEGRenderer(renderer).kittySvg(kitty.traits, kitty.tier);
    }

    function kittyTraits(uint256 kittyId) external view returns (IKPEGRenderer.KittyTraitNames memory) {
        Kitty memory kitty = _kittyView(kittyId);
        if (!kitty.alive) revert KittyDead();
        return IKPEGRenderer(renderer).kittyTraits(kitty.traits);
    }

    function tokenURI(uint256 kittyId) external view returns (string memory) {
        Kitty memory kitty = _kittyView(kittyId);
        if (!kitty.alive) revert KittyDead();
        return IKPEGRenderer(renderer).tokenUriJson(kitty.id, kitty.tier, kitty.traits);
    }

    function getOwnerKitties(address account) external view returns (uint256[] memory) {
        uint256[] memory ids = new uint256[](ownerKittyCount[account]);
        uint256 cursor = 0;
        for (uint256 i = 0; i < liveRanges.length; i += 1) {
            LiveRange memory range = liveRanges[i];
            if (range.owner != account) {
                continue;
            }
            for (uint256 j = 0; j < range.count; j += 1) {
                ids[cursor] = range.startId + j;
                cursor += 1;
            }
        }
        return ids;
    }

    function ownerKittiesLive(address account) external view returns (uint256) {
        return ownerKittyCount[account];
    }

    function directTransferKitty(uint256 kittyId, address to) external returns (bool) {
        if (!_canReceiveKitties(to)) revert CannotReceiveKitty();

        uint256 rangeIndex = _ownedLiveRangeIndex(kittyId, msg.sender);

        syncPaused = true;
        _transfer(msg.sender, to, KITTY_UNIT);
        syncPaused = false;

        _invalidateOwnerKittyTransferApprovals(msg.sender);
        _moveSingleKitty(rangeIndex, kittyId, msg.sender, to);
        emit KittyMoved(kittyId, msg.sender, to);
        return true;
    }

    function directTransferKittiesList(address to, uint256[] calldata kittyIds) external returns (bool) {
        return _directTransferKittiesList(msg.sender, to, kittyIds);
    }

    function directTransferKittiesListFrom(address from, address to, uint256[] calldata kittyIds) external returns (bool) {
        if (from != msg.sender) {
            bool hasGlobalApproval = kittyOperatorApproved[from][msg.sender];
            if (!hasGlobalApproval) {
                uint256 length = kittyIds.length;
                if (length == 0) revert EmptyKittyList();
                uint64 approvalEpoch = kittyTransferApprovalEpoch[from] + 1;
                for (uint256 i = 0; i < length; i += 1) {
                    if (kittyTransferApprovedAtEpoch[from][msg.sender][kittyIds[i]] != approvalEpoch) {
                        revert NotKittyOperator();
                    }
                }
            }
        }
        return _directTransferKittiesList(from, to, kittyIds);
    }

    function replaceBornKPEG(uint256 backingKittyId, address childCustody, uint8 tier, bytes32 seedSalt, uint256 packedTraits)
        external
        onlyBreedingContract
        returns (uint256 kittyId)
    {
        if (!started) revert TokenNotStarted();
        if (!_canReceiveKitties(childCustody)) revert CannotReceiveKitty();
        if (!_isValidPackedTraits(packedTraits)) revert InvalidBornTraits();
        if (_kittyOwner(backingKittyId) != childCustody) revert NotKittyOwner();

        _burnKittyById(childCustody, backingKittyId);

        uint8 mintTier = tier > 4 ? 4 : tier;
        kittyId = _mintKittyBatch(childCustody, mintTier, 1, seedSalt);
        bornTraitOverrides[kittyId] = packedTraits;
        hasBornTraitOverride[kittyId] = true;
        emit BornKPEGMinted(childCustody, kittyId, mintTier, seedSalt, packedTraits);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert BalanceTooLow();
        if (amount == 0 || from == to) {
            emit Transfer(from, to, amount);
            return;
        }

        unchecked {
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);

        if (syncPaused || !started) {
            return;
        }

        if (poolManager == address(0)) revert StartedNotConfigured();

        if (from == poolManager) {
            _onPoolBuy(to, amount);
            return;
        }

        _syncCollectibles(from, to);
    }

    function _onPoolBuy(address to, uint256 amount) internal {
        if (to == address(0) || to == notMintableAccount) {
            return;
        }
        if (amount > maxBuy()) revert BuyLimitExceeded();

        uint256 wholeBought = amount / KITTY_UNIT;
        if (wholeBought == 0) {
            return;
        }

        uint8 tier = _tierFromWholeBought(wholeBought);
        _mintKittyBatch(to, tier, wholeBought);
    }

    function _syncCollectibles(address from, address to) internal {
        uint256 fromAllowed = balanceOf[from] / KITTY_UNIT;
        uint256 fromCount = ownerKittyCount[from];
        if (fromCount <= fromAllowed) {
            return;
        }

        uint256 removable = fromCount - fromAllowed;
        uint256 moveQty = removable < _kittyRoom(to) ? removable : _kittyRoom(to);
        if (moveQty > 0 || removable > moveQty) {
            _invalidateOwnerKittyTransferApprovals(from);
        }
        if (moveQty > 0) {
            _moveTailKitties(from, to, moveQty);
        }

        uint256 burnQty = removable - moveQty;
        if (burnQty > 0) {
            _burnTailKitties(from, burnQty);
        }
    }

    function _kittyRoom(address to) internal view returns (uint256) {
        if (!_canReceiveKitties(to)) {
            return 0;
        }

        uint256 allowed = balanceOf[to] / KITTY_UNIT;
        uint256 current = ownerKittyCount[to];
        return allowed > current ? allowed - current : 0;
    }

    function _mintKittyBatch(address ownerOfKitty, uint8 tier, uint256 batchSizeWhole) internal returns (uint256) {
        return _mintKittyBatch(ownerOfKitty, tier, batchSizeWhole, bytes32(0));
    }

    function _mintKittyBatch(address ownerOfKitty, uint8 tier, uint256 batchSizeWhole, bytes32 seedSalt) internal returns (uint256 startId) {
        startId = kittiesEverMinted + 1;
        bytes32 seedBase = keccak256(
            seedSalt == bytes32(0)
                ? abi.encodePacked(
                    IKPEGEntropySource(hook).randomSeed(),
                    ownerOfKitty,
                    batchSizeWhole,
                    tier,
                    startId,
                    address(this),
                    block.chainid
                )
                : abi.encodePacked(
                    IKPEGEntropySource(hook).randomSeed(),
                    ownerOfKitty,
                    batchSizeWhole,
                    tier,
                    startId,
                    address(this),
                    block.chainid,
                    seedSalt
                )
        );

        kittyBatches.push(
            KittyBatch({
                startId: startId,
                count: batchSizeWhole,
                batchSizeWhole: batchSizeWhole,
                tier: tier,
                seedBase: seedBase
            })
        );
        liveRanges.push(LiveRange({startId: startId, count: batchSizeWhole, owner: ownerOfKitty}));

        kittiesEverMinted += batchSizeWhole;
        kittiesLive += batchSizeWhole;
        ownerKittyCount[ownerOfKitty] += batchSizeWhole;
        emit KittyBatchMinted(ownerOfKitty, startId, batchSizeWhole, tier, batchSizeWhole, seedBase);
        return startId;
    }

    function _moveTailKitties(address from, address to, uint256 quantity) internal {
        uint256 remaining = quantity;
        while (remaining > 0) {
            uint256 rangeIndex = _lastOwnedRangeIndex(from);
            LiveRange memory range = liveRanges[rangeIndex];
            uint256 take = remaining < range.count ? remaining : range.count;
            uint256 movedStart = range.startId + range.count - take;

            if (take == range.count) {
                liveRanges[rangeIndex].owner = to;
            } else {
                liveRanges[rangeIndex].count = range.count - take;
                _insertLiveRange(rangeIndex + 1, LiveRange({startId: movedStart, count: take, owner: to}));
            }

            ownerKittyCount[from] -= take;
            ownerKittyCount[to] += take;
            remaining -= take;
            emit KittyBatchMoved(from, to, movedStart, take);
        }
    }

    function _directTransferKittiesList(address from, address to, uint256[] calldata kittyIds) internal returns (bool) {
        uint256 length = kittyIds.length;
        if (length == 0) revert EmptyKittyList();
        if (!_canReceiveKitties(to)) revert CannotReceiveKitty();

        for (uint256 i = 1; i < length; i += 1) {
            if (kittyIds[i] == kittyIds[i - 1]) revert DuplicateKitty();
            if (kittyIds[i] < kittyIds[i - 1]) revert KittyListNotSorted();
        }

        syncPaused = true;
        _transfer(from, to, KITTY_UNIT * length);
        syncPaused = false;

        _invalidateOwnerKittyTransferApprovals(from);
        uint256 cursor = 0;
        while (cursor < length) {
            uint256 startKittyId = kittyIds[cursor];
            uint256 rangeIndex = _ownedLiveRangeIndex(startKittyId, from);
            LiveRange memory range = liveRanges[rangeIndex];
            uint256 rangeEnd = range.startId + range.count;
            uint256 runCount = 1;

            while (cursor + runCount < length) {
                uint256 nextKittyId = kittyIds[cursor + runCount];
                if (nextKittyId != startKittyId + runCount || nextKittyId >= rangeEnd) {
                    break;
                }
                runCount += 1;
            }

            _moveKittyRun(rangeIndex, startKittyId, runCount, from, to);
            emit KittyBatchMoved(from, to, startKittyId, runCount);
            cursor += runCount;
        }
        return true;
    }

    function _burnTailKitties(address account, uint256 quantity) internal {
        uint256 remaining = quantity;
        while (remaining > 0) {
            uint256 rangeIndex = _lastOwnedRangeIndex(account);
            LiveRange memory range = liveRanges[rangeIndex];
            uint256 take = remaining < range.count ? remaining : range.count;
            uint256 burnedStart = range.startId + range.count - take;

            if (take == range.count) {
                _removeLiveRange(rangeIndex);
            } else {
                liveRanges[rangeIndex].count = range.count - take;
            }

            ownerKittyCount[account] -= take;
            kittiesLive -= take;
            remaining -= take;
            emit KittyBatchBurned(account, burnedStart, take);
        }
    }

    function _burnKittyById(address account, uint256 kittyId) internal {
        uint256 rangeIndex = _ownedLiveRangeIndex(kittyId, account);
        LiveRange memory range = liveRanges[rangeIndex];
        uint256 offset = kittyId - range.startId;

        if (range.count == 1) {
            _removeLiveRange(rangeIndex);
        } else if (offset == 0) {
            liveRanges[rangeIndex].startId = range.startId + 1;
            liveRanges[rangeIndex].count = range.count - 1;
        } else if (offset == range.count - 1) {
            liveRanges[rangeIndex].count = range.count - 1;
        } else {
            liveRanges[rangeIndex].count = offset;
            _insertLiveRange(
                rangeIndex + 1,
                LiveRange({startId: kittyId + 1, count: range.count - offset - 1, owner: account})
            );
        }

        _invalidateOwnerKittyTransferApprovals(account);
        ownerKittyCount[account] -= 1;
        kittiesLive -= 1;
        emit KittyBatchBurned(account, kittyId, 1);
    }

    function _canReceiveKitties(address account) internal view returns (bool) {
        return account != address(0) && account != poolManager;
    }

    function _moveSingleKitty(uint256 rangeIndex, uint256 kittyId, address from, address to) internal {
        LiveRange memory range = liveRanges[rangeIndex];
        uint256 offset = kittyId - range.startId;

        if (range.count == 1) {
            liveRanges[rangeIndex].owner = to;
        } else if (offset == 0) {
            liveRanges[rangeIndex].startId = range.startId + 1;
            liveRanges[rangeIndex].count = range.count - 1;
            _insertLiveRange(rangeIndex, LiveRange({startId: kittyId, count: 1, owner: to}));
        } else if (offset == range.count - 1) {
            liveRanges[rangeIndex].count = range.count - 1;
            _insertLiveRange(rangeIndex + 1, LiveRange({startId: kittyId, count: 1, owner: to}));
        } else {
            liveRanges[rangeIndex].count = offset;
            _insertLiveRange(rangeIndex + 1, LiveRange({startId: kittyId, count: 1, owner: to}));
            _insertLiveRange(
                rangeIndex + 2,
                LiveRange({startId: kittyId + 1, count: range.count - offset - 1, owner: from})
            );
        }

        ownerKittyCount[from] -= 1;
        ownerKittyCount[to] += 1;
    }

    function _moveKittyRun(uint256 rangeIndex, uint256 startKittyId, uint256 runCount, address from, address to) internal {
        LiveRange memory range = liveRanges[rangeIndex];
        uint256 endKittyId = startKittyId + runCount;
        uint256 rangeEnd = range.startId + range.count;
        if (startKittyId < range.startId || endKittyId > rangeEnd || range.owner != from) revert NotKittyOwner();

        uint256 beforeCount = startKittyId - range.startId;
        uint256 afterCount = rangeEnd - endKittyId;

        if (beforeCount == 0 && afterCount == 0) {
            liveRanges[rangeIndex].owner = to;
        } else if (beforeCount == 0) {
            liveRanges[rangeIndex].startId = endKittyId;
            liveRanges[rangeIndex].count = afterCount;
            _insertLiveRange(rangeIndex, LiveRange({startId: startKittyId, count: runCount, owner: to}));
        } else if (afterCount == 0) {
            liveRanges[rangeIndex].count = beforeCount;
            _insertLiveRange(rangeIndex + 1, LiveRange({startId: startKittyId, count: runCount, owner: to}));
        } else {
            liveRanges[rangeIndex].count = beforeCount;
            _insertLiveRange(rangeIndex + 1, LiveRange({startId: startKittyId, count: runCount, owner: to}));
            _insertLiveRange(rangeIndex + 2, LiveRange({startId: endKittyId, count: afterCount, owner: from}));
        }

        ownerKittyCount[from] -= runCount;
        ownerKittyCount[to] += runCount;
    }

    function _isKittyTransferApproved(address owner_, address operator, uint256 kittyId) internal view returns (bool) {
        uint64 approvalEpoch = kittyTransferApprovalEpoch[owner_] + 1;
        return kittyTransferApprovedAtEpoch[owner_][operator][kittyId] == approvalEpoch;
    }

    function _invalidateOwnerKittyTransferApprovals(address owner_) internal {
        if (owner_ == address(0)) return;
        unchecked {
            kittyTransferApprovalEpoch[owner_] += 1;
        }
    }

    function _kittyView(uint256 kittyId) internal view returns (Kitty memory) {
        (bool found, KittyBatch memory batch) = _kittyBatch(kittyId);
        if (!found) {
            return Kitty({id: 0, owner: address(0), tier: 0, seed: 0, traits: 0, alive: false});
        }

        address kittyOwner = _kittyOwner(kittyId);
        bool alive = kittyOwner != address(0);
        bytes32 seed = _kittySeed(batch, kittyId);
        uint256 packedTraits = hasBornTraitOverride[kittyId]
            ? bornTraitOverrides[kittyId]
            : IKPEGRenderer(renderer).generateTraits(kittyId, batch.tier, seed);
        return Kitty({id: kittyId, owner: kittyOwner, tier: batch.tier, seed: seed, traits: packedTraits, alive: alive});
    }

    function _isValidPackedTraits(uint256 packedTraits) internal pure returns (bool) {
        uint8 background = uint8(packedTraits & 0xff);
        uint8 breed = uint8((packedTraits >> 8) & 0xff);
        uint8 clothes = uint8((packedTraits >> 16) & 0xff);
        uint8 mood = uint8((packedTraits >> 24) & 0xff);
        uint8 marks = uint8((packedTraits >> 32) & 0xff);
        uint8 mouth = uint8((packedTraits >> 40) & 0xff);
        uint8 eyes = uint8((packedTraits >> 48) & 0xff);
        uint8 accessory = uint8((packedTraits >> 56) & 0xff);
        return background < BACKGROUND_COUNT
            && breed < BREED_COUNT
            && clothes < CLOTHES_COUNT
            && mood < MOOD_COUNT
            && marks < MARK_COUNT
            && mouth < MOUTH_COUNT
            && eyes < EYE_COUNT
            && accessory < ACCESSORY_COUNT;
    }

    function _kittyOwner(uint256 kittyId) internal view returns (address) {
        (bool found, uint256 index) = _liveRangeIndex(kittyId);
        if (found) {
            return liveRanges[index].owner;
        }
        return address(0);
    }

    function _ownedLiveRangeIndex(uint256 kittyId, address expectedOwner) internal view returns (uint256) {
        (bool found, uint256 index) = _liveRangeIndex(kittyId);
        if (!found) revert KittyDead();
        if (liveRanges[index].owner != expectedOwner) revert NotKittyOwner();
        return index;
    }

    function _lastOwnedRangeIndex(address account) internal view returns (uint256) {
        for (uint256 i = liveRanges.length; i > 0; i -= 1) {
            if (liveRanges[i - 1].owner == account) {
                return i - 1;
            }
        }
        revert KittyDead();
    }

    function _kittyBatch(uint256 kittyId) internal view returns (bool, KittyBatch memory) {
        if (kittyId == 0 || kittyId > kittiesEverMinted) {
            return (false, KittyBatch({startId: 0, count: 0, batchSizeWhole: 0, tier: 0, seedBase: 0}));
        }

        uint256 low = 0;
        uint256 high = kittyBatches.length;
        while (low < high) {
            uint256 mid = (low + high) / 2;
            KittyBatch memory batch = kittyBatches[mid];
            if (kittyId < batch.startId) {
                high = mid;
            } else if (kittyId >= batch.startId + batch.count) {
                low = mid + 1;
            } else {
                return (true, batch);
            }
        }
        return (false, KittyBatch({startId: 0, count: 0, batchSizeWhole: 0, tier: 0, seedBase: 0}));
    }

    function _liveRangeIndex(uint256 kittyId) internal view returns (bool, uint256) {
        uint256 low = 0;
        uint256 high = liveRanges.length;
        while (low < high) {
            uint256 mid = (low + high) / 2;
            LiveRange memory range = liveRanges[mid];
            if (kittyId < range.startId) {
                high = mid;
            } else if (kittyId >= range.startId + range.count) {
                low = mid + 1;
            } else {
                return (true, mid);
            }
        }
        return (false, 0);
    }

    function _kittySeed(KittyBatch memory batch, uint256 kittyId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(batch.seedBase, kittyId, batch.tier, batch.batchSizeWhole));
    }

    function _insertLiveRange(uint256 index, LiveRange memory range) internal {
        liveRanges.push(range);
        for (uint256 i = liveRanges.length - 1; i > index; i -= 1) {
            liveRanges[i] = liveRanges[i - 1];
        }
        liveRanges[index] = range;
    }

    function _removeLiveRange(uint256 index) internal {
        for (uint256 i = index; i + 1 < liveRanges.length; i += 1) {
            liveRanges[i] = liveRanges[i + 1];
        }
        liveRanges.pop();
    }

    function _tierFromWholeBought(uint256 wholeBought) internal pure returns (uint8) {
        if (wholeBought <= 9) {
            return 0;
        }
        if (wholeBought <= 49) {
            return 1;
        }
        if (wholeBought <= 99) {
            return 2;
        }
        if (wholeBought <= 249) {
            return 3;
        }
        return 4;
    }
}
