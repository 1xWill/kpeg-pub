// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IKPEGBreedingToken {
    function directTransferKittiesListFrom(address from, address to, uint256[] calldata kittyIds) external returns (bool);
    function directTransferKitty(uint256 kittyId, address to) external returns (bool);
    function kitties(uint256 kittyId)
        external
        view
        returns (uint256 id, address owner, uint8 tier, bytes32 seed, uint256 traits, bool alive);
}

interface IKPEGBreedingGateway {
    function replaceBornKPEG(
        uint256 backingKittyId,
        address childCustody,
        uint8 tier,
        bytes32 seedSalt,
        uint256 packedTraits
    ) external returns (uint256);
}

interface IKPEGBreedingEntropySource {
    function randomSeed() external view returns (bytes32);
}

contract KPEGBreeding {
    error OnlyOwner();
    error Paused();
    error InvalidAddress();
    error InvalidPool();
    error InvalidPoolState();
    error InvalidParent();
    error ParentLocked();
    error ParentCoolingDown();
    error NotPoolParticipant();
    error NotClaimOwner();
    error InvalidFilters();
    error NotReadyForSettlement();
    error IncompatibleChildTraits();
    error InvalidBacking();
    error BackingLocked();
    error BackingAlreadyStaked();
    error BackingSlotsFull();
    error ReentrantCall();

    uint8 private constant BACKGROUND_COUNT = 6;
    uint8 private constant BREED_COUNT = 20;
    uint8 private constant CLOTHES_COUNT = 18;
    uint8 private constant MOOD_COUNT = 12;
    uint8 private constant MARK_COUNT = 4;
    uint8 private constant MOUTH_COUNT = 12;
    uint8 private constant EYE_COUNT = 12;
    uint8 private constant ACCESSORY_COUNT = 17;

    uint64 private constant SUCCESS_COOLDOWN_SECONDS = 3 days;

    enum PoolType {
        Private,
        Public
    }

    enum PoolStatus {
        Open,
        Cycling,
        Cancelled
    }

    enum SettleResult {
        SUCCESS,
        FAILED_ROLL
    }

    struct Pool {
        PoolType poolType;
        PoolStatus status;
        address host;
        address joiner;
        uint256 parentA;
        uint256 parentB;
        address parentAOwner;
        address parentBOwner;
        uint64 cycleStartedAt;
        uint16 cycleDays;
        address currentBackingProvider;
        uint256 currentBackingKittyId;
        uint8 currentBackingSide;
        address queuedBackingProvider;
        uint256 queuedBackingKittyId;
        uint8 queuedBackingSide;
        uint8 filterCount;
        uint8[5] filterGroups;
        uint8[5] filterTraits;
    }

    struct Claim {
        uint256 poolId;
        uint256 childKittyId;
        address childOwner;
        bool claimed;
        uint64 createdAt;
    }

    struct TraitIds {
        uint8 background;
        uint8 breed;
        uint8 clothes;
        uint8 mood;
        uint8 marks;
        uint8 mouth;
        uint8 eyes;
        uint8 accessory;
    }

    struct SettlementComputation {
        uint8 childTier;
        uint8 mutationCount;
        uint256 traitsA;
        uint256 traitsB;
        uint256 childPackedTraits;
    }

    struct CandidateContext {
        uint8 group;
        uint8 parentTraitA;
        uint8 parentTraitB;
        uint8 childTier;
        bytes32 settlementSeed;
        uint8 step;
        uint8 source;
        TraitIds partialChild;
    }

    IKPEGBreedingToken public immutable token;
    IKPEGBreedingGateway public immutable birthGateway;
    IKPEGBreedingEntropySource public immutable entropySource;
    address public owner;
    bool public paused;
    uint256 private unlocked = 1;

    uint256 public nextPoolId = 1;
    uint256 public nextClaimId = 1;
    bytes32 public gameSeed;

    mapping(uint256 => Pool) public pools;
    mapping(uint256 => Claim) public claims;
    mapping(uint256 => uint256) public kittyPool;
    mapping(uint256 => uint64) public parentCooldownUntil;
    mapping(bytes32 => uint256) public pairBirthCount;

    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);
    event BreedingPausedSet(bool paused);
    event BreedingPoolCreated(
        uint256 indexed poolId,
        address indexed host,
        uint8 poolType,
        uint256 parentA,
        uint256 parentB,
        uint64 cycleStartedAt,
        uint16 cycleDays,
        uint8 filterCount,
        uint8[5] filterGroups,
        uint8[5] filterTraits
    );
    event BreedingPoolJoined(uint256 indexed poolId, address indexed joiner, uint256 parentB, uint64 cycleStartedAt, uint16 cycleDays);
    event BreedingPoolLeft(uint256 indexed poolId, address indexed account, uint256 returnedParentA, uint256 returnedParentB, uint8 nextStatus);
    event BreedingSettled(
        uint256 indexed poolId,
        uint8 result,
        uint8 childTier,
        uint256 childKittyId,
        uint256 claimId,
        address childOwner,
        bytes32 childSeedSalt,
        uint256 childPackedTraits
    );
    event BreedingLineage(uint256 indexed childKittyId, uint256 indexed parentA, uint256 indexed parentB, uint256 poolId, address childOwner);
    event BreedingCooldownSet(uint256 indexed parentId, uint64 cooldownUntil);
    event BreedingClaimed(uint256 indexed claimId, uint256 indexed poolId, uint256 indexed childKittyId, address owner);
    event BreedingCycleReset(uint256 indexed poolId, uint64 cycleStartedAt, uint16 cycleDays, uint8 status);
    event BreedingBackingStaked(uint256 indexed poolId, address indexed provider, uint256 indexed backingKittyId, uint8 side, bool queued);
    event BreedingBackingWithdrawn(uint256 indexed poolId, address indexed provider, uint256 indexed backingKittyId, uint8 side, bool queued);
    event BreedingBackingConsumed(uint256 indexed poolId, address indexed provider, uint256 indexed backingKittyId, uint8 side);
    event BreedingBackingPromoted(uint256 indexed poolId, address indexed provider, uint256 indexed backingKittyId, uint8 side);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        if (unlocked != 1) revert ReentrantCall();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    constructor(address tokenAddress, address gatewayAddress, address entropySourceAddress, address initialOwner) {
        if (tokenAddress == address(0) || gatewayAddress == address(0) || entropySourceAddress == address(0) || initialOwner == address(0)) {
            revert InvalidAddress();
        }
        token = IKPEGBreedingToken(tokenAddress);
        birthGateway = IKPEGBreedingGateway(gatewayAddress);
        entropySource = IKPEGBreedingEntropySource(entropySourceAddress);
        owner = initialOwner;
        gameSeed = keccak256(abi.encodePacked(block.chainid, address(this), tokenAddress, gatewayAddress, entropySourceAddress));
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit BreedingPausedSet(value);
    }

    function createPrivatePool(uint256 parentA, uint256 parentB, uint256 backingKittyId)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 poolId)
    {
        if (parentA == 0 || parentB == 0 || parentA == parentB) revert InvalidParent();
        if (backingKittyId == 0 || backingKittyId == parentA || backingKittyId == parentB) revert InvalidBacking();
        if (kittyPool[parentA] != 0 || kittyPool[parentB] != 0) revert ParentLocked();
        if (kittyPool[backingKittyId] != 0) revert BackingLocked();
        _revertIfCoolingDown(parentA);
        _revertIfCoolingDown(parentB);

        uint256[] memory kittyIds = _sortedThree(parentA, parentB, backingKittyId);
        token.directTransferKittiesListFrom(msg.sender, address(this), kittyIds);
        uint16 cycleDays = _max(_cycleDaysForParent(parentA), _cycleDaysForParent(parentB));

        poolId = nextPoolId++;
        Pool storage pool = pools[poolId];
        pool.poolType = PoolType.Private;
        pool.status = PoolStatus.Cycling;
        pool.host = msg.sender;
        pool.parentA = parentA;
        pool.parentB = parentB;
        pool.parentAOwner = msg.sender;
        pool.parentBOwner = msg.sender;
        pool.cycleStartedAt = uint64(block.timestamp);
        pool.cycleDays = cycleDays;
        pool.currentBackingProvider = msg.sender;
        pool.currentBackingKittyId = backingKittyId;
        pool.currentBackingSide = 0;

        kittyPool[parentA] = poolId;
        kittyPool[parentB] = poolId;
        kittyPool[backingKittyId] = poolId;
        uint8[5] memory emptyGroups;
        uint8[5] memory emptyTraits;
        emit BreedingPoolCreated(
            poolId,
            msg.sender,
            uint8(PoolType.Private),
            parentA,
            parentB,
            pool.cycleStartedAt,
            pool.cycleDays,
            0,
            emptyGroups,
            emptyTraits
        );
        emit BreedingBackingStaked(poolId, msg.sender, backingKittyId, 0, false);
    }

    function createPublicPool(uint256 parent, uint8[] calldata filterGroups, uint8[] calldata filterTraits)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 poolId)
    {
        if (parent == 0) revert InvalidParent();
        if (kittyPool[parent] != 0) revert ParentLocked();
        if (filterGroups.length != filterTraits.length || filterGroups.length > 5) revert InvalidFilters();
        bool[8] memory seenGroups;
        for (uint8 i = 0; i < filterGroups.length; i++) {
            uint8 group = filterGroups[i];
            uint8 trait = filterTraits[i];
            if (group > 7) revert InvalidFilters();
            if (seenGroups[group]) revert InvalidFilters();
            if (trait >= _traitCount(group)) revert InvalidFilters();
            seenGroups[group] = true;
        }
        _revertIfCoolingDown(parent);

        uint256[] memory parentIds = new uint256[](1);
        parentIds[0] = parent;
        token.directTransferKittiesListFrom(msg.sender, address(this), parentIds);

        poolId = nextPoolId++;
        Pool storage pool = pools[poolId];
        pool.poolType = PoolType.Public;
        pool.status = PoolStatus.Open;
        pool.host = msg.sender;
        pool.parentA = parent;
        pool.parentAOwner = msg.sender;
        pool.cycleDays = _cycleDaysForParent(parent);
        pool.filterCount = uint8(filterGroups.length);
        for (uint8 i = 0; i < pool.filterCount; i++) {
            pool.filterGroups[i] = filterGroups[i];
            pool.filterTraits[i] = filterTraits[i];
        }

        kittyPool[parent] = poolId;
        emit BreedingPoolCreated(
            poolId,
            msg.sender,
            uint8(PoolType.Public),
            parent,
            0,
            0,
            pool.cycleDays,
            pool.filterCount,
            pool.filterGroups,
            pool.filterTraits
        );
    }

    function joinPublicPool(uint256 poolId, uint256 parent) external whenNotPaused nonReentrant {
        Pool storage pool = pools[poolId];
        if (pool.host == address(0)) revert InvalidPool();
        if (pool.poolType != PoolType.Public || pool.status != PoolStatus.Open || pool.joiner != address(0)) revert InvalidPoolState();
        if (parent == 0 || kittyPool[parent] != 0) revert ParentLocked();
        _revertIfCoolingDown(parent);

        (, , , , uint256 packedTraits, bool alive) = token.kitties(parent);
        if (!alive) revert InvalidParent();
        if (!_matchesFilters(pool, _decodeTraits(packedTraits))) revert InvalidFilters();

        uint256[] memory parentIds = new uint256[](1);
        parentIds[0] = parent;
        token.directTransferKittiesListFrom(msg.sender, address(this), parentIds);

        pool.joiner = msg.sender;
        pool.parentB = parent;
        pool.parentBOwner = msg.sender;
        pool.cycleDays = _max(pool.cycleDays, _cycleDaysForParent(parent));
        kittyPool[parent] = poolId;

        if (_isCycleReady(pool) && pool.status != PoolStatus.Cycling) {
            pool.status = PoolStatus.Cycling;
            pool.cycleStartedAt = uint64(block.timestamp);
        }

        emit BreedingPoolJoined(poolId, msg.sender, parent, pool.cycleStartedAt, pool.cycleDays);
        if (pool.status == PoolStatus.Cycling) {
            _emitCycleReset(poolId);
        }
    }

    function stakeBacking(uint256 poolId, uint256 backingKittyId) external whenNotPaused nonReentrant {
        Pool storage pool = pools[poolId];
        if (pool.host == address(0)) revert InvalidPool();
        if (pool.status == PoolStatus.Cancelled) revert InvalidPoolState();
        _autoSettleReadyPool(poolId, pool);
        if (backingKittyId == 0 || backingKittyId == pool.parentA || backingKittyId == pool.parentB) revert InvalidBacking();
        if (kittyPool[backingKittyId] != 0) revert BackingLocked();

        uint8 side = _participantSide(pool, msg.sender);
        if (_sideHasBacking(pool, side)) revert BackingAlreadyStaked();

        (, address ownerOfBacking, , , , bool alive) = token.kitties(backingKittyId);
        if (!alive || ownerOfBacking != msg.sender) revert InvalidBacking();

        uint256[] memory ids = new uint256[](1);
        ids[0] = backingKittyId;
        token.directTransferKittiesListFrom(msg.sender, address(this), ids);
        kittyPool[backingKittyId] = poolId;

        bool queued = false;
        if (pool.currentBackingKittyId == 0) {
            pool.currentBackingProvider = msg.sender;
            pool.currentBackingKittyId = backingKittyId;
            pool.currentBackingSide = side;
        } else {
            if (pool.poolType == PoolType.Private) revert BackingSlotsFull();
            if (pool.currentBackingSide == side) revert BackingAlreadyStaked();
            if (pool.queuedBackingKittyId != 0) revert BackingSlotsFull();
            pool.queuedBackingProvider = msg.sender;
            pool.queuedBackingKittyId = backingKittyId;
            pool.queuedBackingSide = side;
            queued = true;
        }

        emit BreedingBackingStaked(poolId, msg.sender, backingKittyId, side, queued);
        if (!queued && _isCycleReady(pool) && pool.status != PoolStatus.Cycling) {
            pool.status = PoolStatus.Cycling;
            pool.cycleStartedAt = uint64(block.timestamp);
            _emitCycleReset(poolId);
        }
    }

    function withdrawBacking(uint256 poolId) external whenNotPaused nonReentrant {
        Pool storage pool = pools[poolId];
        if (pool.host == address(0)) revert InvalidPool();
        if (pool.status == PoolStatus.Cancelled) revert InvalidPoolState();
        _autoSettleReadyPool(poolId, pool);

        bool changed = false;
        if (pool.currentBackingProvider == msg.sender && pool.currentBackingKittyId != 0) {
            _withdrawCurrentBacking(poolId, pool);
            changed = true;
        } else if (pool.queuedBackingProvider == msg.sender && pool.queuedBackingKittyId != 0) {
            _withdrawQueuedBacking(poolId, pool);
            changed = true;
        }
        if (!changed) revert NotPoolParticipant();

        if (_isCycleReady(pool)) {
            pool.status = PoolStatus.Cycling;
            pool.cycleStartedAt = uint64(block.timestamp);
        } else {
            pool.status = PoolStatus.Open;
            pool.cycleStartedAt = 0;
        }
        _emitCycleReset(poolId);
    }

    function leavePool(uint256 poolId) external nonReentrant {
        Pool storage pool = pools[poolId];
        if (pool.host == address(0)) revert InvalidPool();
        if (pool.status == PoolStatus.Cancelled) revert InvalidPoolState();
        _autoSettleReadyPool(poolId, pool);

        if (pool.poolType == PoolType.Private) {
            _leavePrivatePool(poolId, pool);
            return;
        }

        _leavePublicPool(poolId, pool);
    }

    function _leavePrivatePool(uint256 poolId, Pool storage pool) internal {
        if (msg.sender != pool.host) revert NotPoolParticipant();
        uint256 returnedParentA = pool.parentA;
        uint256 returnedParentB = pool.parentB;

        _releaseParent(pool.parentA, pool.parentAOwner);
        _releaseParent(pool.parentB, pool.parentBOwner);
        _releaseCurrentBacking(poolId, pool);
        _releaseQueuedBacking(poolId, pool);

        pool.status = PoolStatus.Cancelled;
        pool.joiner = address(0);
        pool.parentA = 0;
        pool.parentB = 0;
        pool.parentAOwner = address(0);
        pool.parentBOwner = address(0);
        pool.cycleStartedAt = 0;
        pool.cycleDays = 0;

        emit BreedingPoolLeft(poolId, msg.sender, returnedParentA, returnedParentB, uint8(PoolStatus.Cancelled));
        _emitCycleReset(poolId);
    }

    function _leavePublicPool(uint256 poolId, Pool storage pool) internal {
        if (msg.sender == pool.host) {
            uint256 returnedParentA = pool.parentA;
            uint256 returnedParentB = pool.parentB;

            _releaseParent(pool.parentA, pool.parentAOwner);
            _releaseParent(pool.parentB, pool.parentBOwner);
            _releaseCurrentBacking(poolId, pool);
            _releaseQueuedBacking(poolId, pool);

            pool.status = PoolStatus.Cancelled;
            pool.joiner = address(0);
            pool.parentA = 0;
            pool.parentB = 0;
            pool.parentAOwner = address(0);
            pool.parentBOwner = address(0);
            pool.cycleStartedAt = 0;
            pool.cycleDays = 0;

            emit BreedingPoolLeft(poolId, msg.sender, returnedParentA, returnedParentB, uint8(PoolStatus.Cancelled));
            _emitCycleReset(poolId);
            return;
        }

        if (msg.sender != pool.joiner) revert NotPoolParticipant();
        uint256 returnedJoinerParentB = pool.parentB;
        _releaseParent(pool.parentB, pool.parentBOwner);
        _releaseBackingForSide(poolId, pool, 1);

        pool.joiner = address(0);
        pool.parentB = 0;
        pool.parentBOwner = address(0);
        pool.status = PoolStatus.Open;
        pool.cycleStartedAt = 0;
        pool.cycleDays = pool.parentA == 0 ? 0 : _cycleDaysForParent(pool.parentA);

        emit BreedingPoolLeft(poolId, msg.sender, 0, returnedJoinerParentB, uint8(PoolStatus.Open));
        _emitCycleReset(poolId);
    }

    function settle(uint256 poolId) external whenNotPaused nonReentrant {
        Pool storage pool = pools[poolId];
        if (pool.host == address(0)) revert InvalidPool();
        _settlePool(poolId, pool);
    }

    function claimChild(uint256 claimId) external nonReentrant {
        Claim storage claim = claims[claimId];
        if (claim.childOwner == address(0) || claim.claimed) revert InvalidPoolState();
        if (msg.sender != claim.childOwner) revert NotClaimOwner();
        token.directTransferKitty(claim.childKittyId, claim.childOwner);
        claim.claimed = true;
        emit BreedingClaimed(claimId, claim.poolId, claim.childKittyId, claim.childOwner);
    }

    function _settlementSeed(uint256 poolId, Pool storage pool) internal returns (bytes32 settlementSeed) {
        bytes32 hookSeed = entropySource.randomSeed();
        settlementSeed = keccak256(
            abi.encodePacked(
                gameSeed,
                hookSeed,
                poolId,
                pool.parentA,
                pool.parentB,
                pool.currentBackingKittyId,
                pool.currentBackingProvider,
                block.number,
                block.prevrandao,
                blockhash(block.number - 1),
                address(this),
                block.chainid
            )
        );
        gameSeed = keccak256(abi.encodePacked(gameSeed, settlementSeed));
    }

    function _computeSettlement(Pool storage pool, bytes32 settlementSeed) internal view returns (SettlementComputation memory data) {
        (uint8 tierA, uint256 traitsA) = _parentTraits(pool.parentA);
        (uint8 tierB, uint256 traitsB) = _parentTraits(pool.parentB);
        data.childTier = _selectChildTier(tierA, tierB, uint256(settlementSeed));
        (data.childPackedTraits, data.mutationCount) = _selectChildTraits(traitsA, traitsB, data.childTier, settlementSeed);
        data.traitsA = traitsA;
        data.traitsB = traitsB;
    }

    function _isSuccessfulRoll(Pool storage pool, SettlementComputation memory data, bytes32 settlementSeed) internal view returns (bool) {
        uint16 successBp = _successBasisPoints(pool, data.childTier, data.traitsA, data.traitsB, data.mutationCount);
        uint256 successRoll = uint256(keccak256(abi.encodePacked(settlementSeed, "BREED_SUCCESS"))) % 10_000;
        return successRoll < successBp;
    }

    function _settleFailedRoll(uint256 poolId, Pool storage pool, uint8 childTier, uint256 childPackedTraits) internal {
        pool.status = PoolStatus.Cycling;
        pool.cycleStartedAt = uint64(block.timestamp);
        _rotateBackingOnFailedRoll(poolId, pool);
        emit BreedingSettled(poolId, uint8(SettleResult.FAILED_ROLL), childTier, 0, 0, address(0), bytes32(0), childPackedTraits);
        _emitCycleReset(poolId);
    }

    function _settleSuccess(uint256 poolId, Pool storage pool, uint8 childTier, uint256 childPackedTraits, bytes32 settlementSeed)
        internal
    {
        address childOwner = pool.currentBackingProvider;
        uint256 backingKittyId = pool.currentBackingKittyId;
        uint8 backingSide = pool.currentBackingSide;
        if (childOwner == address(0) || backingKittyId == 0) revert InvalidPoolState();

        bytes32 childSeedSalt = keccak256(
            abi.encodePacked(settlementSeed, poolId, pool.parentA, pool.parentB, childTier, childPackedTraits)
        );

        uint256 childKittyId =
            birthGateway.replaceBornKPEG(backingKittyId, address(this), childTier, childSeedSalt, childPackedTraits);

        delete kittyPool[backingKittyId];
        emit BreedingBackingConsumed(poolId, childOwner, backingKittyId, backingSide);

        _clearCurrentBacking(pool);
        if (pool.queuedBackingKittyId != 0) {
            _promoteQueuedBacking(poolId, pool);
        }

        _finalizeSuccessfulBirth(poolId, pool, childTier, childPackedTraits, childOwner, childSeedSalt, childKittyId);
    }

    function _finalizeSuccessfulBirth(
        uint256 poolId,
        Pool storage pool,
        uint8 childTier,
        uint256 childPackedTraits,
        address childOwner,
        bytes32 childSeedSalt,
        uint256 childKittyId
    ) internal {

        uint256 claimId = nextClaimId++;
        claims[claimId] = Claim({
            poolId: poolId,
            childKittyId: childKittyId,
            childOwner: childOwner,
            claimed: false,
            createdAt: uint64(block.timestamp)
        });

        bytes32 pairKey = _pairKey(pool.parentA, pool.parentB);
        pairBirthCount[pairKey] += 1;
        uint64 cooldownUntil = uint64(block.timestamp + SUCCESS_COOLDOWN_SECONDS);
        parentCooldownUntil[pool.parentA] = cooldownUntil;
        parentCooldownUntil[pool.parentB] = cooldownUntil;
        if (_isCycleReady(pool)) {
            pool.cycleStartedAt = cooldownUntil;
            pool.status = PoolStatus.Cycling;
        } else {
            pool.cycleStartedAt = 0;
            pool.status = PoolStatus.Open;
        }

        emit BreedingCooldownSet(pool.parentA, cooldownUntil);
        emit BreedingCooldownSet(pool.parentB, cooldownUntil);
        emit BreedingLineage(childKittyId, pool.parentA, pool.parentB, poolId, childOwner);
        emit BreedingSettled(poolId, uint8(SettleResult.SUCCESS), childTier, childKittyId, claimId, childOwner, childSeedSalt, childPackedTraits);
        _emitCycleReset(poolId);
    }

    function _emitCycleReset(uint256 poolId) internal {
        Pool storage pool = pools[poolId];
        emit BreedingCycleReset(poolId, pool.cycleStartedAt, pool.cycleDays, uint8(pool.status));
    }

    function _isCycleReady(Pool storage pool) internal view returns (bool) {
        return pool.parentA != 0 && pool.parentB != 0 && pool.currentBackingKittyId != 0;
    }

    function _participantSide(Pool storage pool, address account) internal view returns (uint8 side) {
        if (account == pool.host) {
            return 0;
        }
        if (pool.poolType == PoolType.Public && account == pool.joiner) {
            return 1;
        }
        revert NotPoolParticipant();
    }

    function _sideHasBacking(Pool storage pool, uint8 side) internal view returns (bool) {
        if (pool.currentBackingKittyId != 0 && pool.currentBackingSide == side) {
            return true;
        }
        if (pool.queuedBackingKittyId != 0 && pool.queuedBackingSide == side) {
            return true;
        }
        return false;
    }

    function _sortedThree(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](3);
        ids[0] = a;
        ids[1] = b;
        ids[2] = c;
        if (ids[0] > ids[1]) (ids[0], ids[1]) = (ids[1], ids[0]);
        if (ids[1] > ids[2]) (ids[1], ids[2]) = (ids[2], ids[1]);
        if (ids[0] > ids[1]) (ids[0], ids[1]) = (ids[1], ids[0]);
    }

    function _clearCurrentBacking(Pool storage pool) internal {
        pool.currentBackingProvider = address(0);
        pool.currentBackingKittyId = 0;
        pool.currentBackingSide = 0;
    }

    function _clearQueuedBacking(Pool storage pool) internal {
        pool.queuedBackingProvider = address(0);
        pool.queuedBackingKittyId = 0;
        pool.queuedBackingSide = 0;
    }

    function _rotateBackingOnFailedRoll(uint256 poolId, Pool storage pool) internal {
        if (pool.queuedBackingKittyId == 0) {
            return;
        }
        address previousCurrentProvider = pool.currentBackingProvider;
        uint256 previousCurrentKittyId = pool.currentBackingKittyId;
        uint8 previousCurrentSide = pool.currentBackingSide;

        pool.currentBackingProvider = pool.queuedBackingProvider;
        pool.currentBackingKittyId = pool.queuedBackingKittyId;
        pool.currentBackingSide = pool.queuedBackingSide;
        emit BreedingBackingPromoted(poolId, pool.currentBackingProvider, pool.currentBackingKittyId, pool.currentBackingSide);

        pool.queuedBackingProvider = previousCurrentProvider;
        pool.queuedBackingKittyId = previousCurrentKittyId;
        pool.queuedBackingSide = previousCurrentSide;
        emit BreedingBackingStaked(
            poolId,
            pool.queuedBackingProvider,
            pool.queuedBackingKittyId,
            pool.queuedBackingSide,
            true
        );
    }

    function _isPoolReadyForSettlement(Pool storage pool) internal view returns (bool) {
        if (pool.status != PoolStatus.Cycling) return false;
        if (!_isCycleReady(pool)) return false;
        if (
            kittyPool[pool.parentA] == 0 || kittyPool[pool.parentA] != kittyPool[pool.parentB]
                || kittyPool[pool.currentBackingKittyId] != kittyPool[pool.parentA]
        ) {
            return false;
        }
        if (block.timestamp < uint256(pool.cycleStartedAt) + uint256(pool.cycleDays) * 1 days) return false;
        if (parentCooldownUntil[pool.parentA] > block.timestamp || parentCooldownUntil[pool.parentB] > block.timestamp) return false;
        return true;
    }

    function _autoSettleReadyPool(uint256 poolId, Pool storage pool) internal {
        if (!_isPoolReadyForSettlement(pool)) {
            return;
        }
        _settlePool(poolId, pool);
    }

    function _settlePool(uint256 poolId, Pool storage pool) internal {
        if (!_isPoolReadyForSettlement(pool)) revert NotReadyForSettlement();
        bytes32 settlementSeed = _settlementSeed(poolId, pool);
        SettlementComputation memory computation = _computeSettlement(pool, settlementSeed);
        if (!_isSuccessfulRoll(pool, computation, settlementSeed)) {
            _settleFailedRoll(poolId, pool, computation.childTier, computation.childPackedTraits);
            return;
        }
        _settleSuccess(poolId, pool, computation.childTier, computation.childPackedTraits, settlementSeed);
    }

    function _promoteQueuedBacking(uint256 poolId, Pool storage pool) internal {
        pool.currentBackingProvider = pool.queuedBackingProvider;
        pool.currentBackingKittyId = pool.queuedBackingKittyId;
        pool.currentBackingSide = pool.queuedBackingSide;
        emit BreedingBackingPromoted(
            poolId,
            pool.currentBackingProvider,
            pool.currentBackingKittyId,
            pool.currentBackingSide
        );
        _clearQueuedBacking(pool);
    }

    function _withdrawCurrentBacking(uint256 poolId, Pool storage pool) internal {
        uint256 kittyId = pool.currentBackingKittyId;
        if (kittyId == 0) return;
        address provider = pool.currentBackingProvider;
        uint8 side = pool.currentBackingSide;

        delete kittyPool[kittyId];
        token.directTransferKitty(kittyId, provider);
        emit BreedingBackingWithdrawn(poolId, provider, kittyId, side, false);
        _clearCurrentBacking(pool);
        if (pool.queuedBackingKittyId != 0) {
            _promoteQueuedBacking(poolId, pool);
        }
    }

    function _withdrawQueuedBacking(uint256 poolId, Pool storage pool) internal {
        uint256 kittyId = pool.queuedBackingKittyId;
        if (kittyId == 0) return;
        address provider = pool.queuedBackingProvider;
        uint8 side = pool.queuedBackingSide;

        delete kittyPool[kittyId];
        token.directTransferKitty(kittyId, provider);
        emit BreedingBackingWithdrawn(poolId, provider, kittyId, side, true);
        _clearQueuedBacking(pool);
    }

    function _releaseCurrentBacking(uint256 poolId, Pool storage pool) internal {
        uint256 kittyId = pool.currentBackingKittyId;
        if (kittyId == 0) return;
        address provider = pool.currentBackingProvider;
        uint8 side = pool.currentBackingSide;
        delete kittyPool[kittyId];
        token.directTransferKitty(kittyId, provider);
        emit BreedingBackingWithdrawn(poolId, provider, kittyId, side, false);
        _clearCurrentBacking(pool);
    }

    function _releaseQueuedBacking(uint256 poolId, Pool storage pool) internal {
        uint256 kittyId = pool.queuedBackingKittyId;
        if (kittyId == 0) return;
        address provider = pool.queuedBackingProvider;
        uint8 side = pool.queuedBackingSide;
        delete kittyPool[kittyId];
        token.directTransferKitty(kittyId, provider);
        emit BreedingBackingWithdrawn(poolId, provider, kittyId, side, true);
        _clearQueuedBacking(pool);
    }

    function _releaseBackingForSide(uint256 poolId, Pool storage pool, uint8 side) internal {
        if (pool.currentBackingKittyId != 0 && pool.currentBackingSide == side) {
            _withdrawCurrentBacking(poolId, pool);
            return;
        }
        if (pool.queuedBackingKittyId != 0 && pool.queuedBackingSide == side) {
            _withdrawQueuedBacking(poolId, pool);
        }
    }

    function _successBasisPoints(
        Pool storage pool,
        uint8 childTier,
        uint256 parentTraitsA,
        uint256 parentTraitsB,
        uint8 mutationCount
    ) internal view returns (uint16) {
        uint8 similarity = _similarity(parentTraitsA, parentTraitsB);
        uint16 diversityBonus = uint16(_min(1800, (uint16(8 - similarity) * 150) + (uint16(mutationCount) * 75)));
        uint16 tierPenalty = _tierPenalty(childTier);
        bytes32 pairKey = _pairKey(pool.parentA, pool.parentB);
        uint16 lineagePenalty = pairBirthCount[pairKey] > 0 ? 800 : 0;
        int256 raw = int256(uint256(4200 + diversityBonus)) - int256(uint256(tierPenalty + lineagePenalty));
        if (raw < 1000) return 1000;
        if (raw > 7200) return 7200;
        return uint16(uint256(raw));
    }

    function _similarity(uint256 parentTraitsA, uint256 parentTraitsB) internal pure returns (uint8 similarity) {
        for (uint8 group = 0; group < 8; group++) {
            if (_traitByGroup(parentTraitsA, group) == _traitByGroup(parentTraitsB, group)) {
                similarity += 1;
            }
        }
    }

    function _selectChildTier(uint8 tierA, uint8 tierB, uint256 entropy) internal pure returns (uint8) {
        uint8 parentAvg = uint8((uint16(tierA) + uint16(tierB)) / 2);
        uint8 highTier = tierA > tierB ? tierA : tierB;
        uint16[5] memory weights = _childTierWeightRow(parentAvg);

        if (highTier > parentAvg) {
            uint16 shift = 5;
            for (uint8 i = 0; i < highTier; i++) {
                if (shift == 0) break;
                uint16 available = weights[i];
                uint16 take = available < shift ? available : shift;
                weights[i] -= take;
                shift -= take;
                weights[highTier] += take;
            }
        }

        uint16 total;
        for (uint8 i = 0; i < 5; i++) total += weights[i];
        uint256 roll = entropy % total;
        uint16 cursor;
        for (uint8 i = 0; i < 5; i++) {
            cursor += weights[i];
            if (roll < cursor) return i;
        }
        return 0;
    }

    function _childTierWeightRow(uint8 parentAvgTier) internal pure returns (uint16[5] memory weights) {
        if (parentAvgTier == 0) return [uint16(70), 22, 7, 1, 0];
        if (parentAvgTier == 1) return [uint16(35), 42, 18, 4, 1];
        if (parentAvgTier == 2) return [uint16(15), 30, 38, 14, 3];
        if (parentAvgTier == 3) return [uint16(6), 18, 32, 34, 10];
        return [uint16(2), 8, 22, 38, 30];
    }

    function _selectChildTraits(uint256 parentTraitsA, uint256 parentTraitsB, uint8 childTier, bytes32 settlementSeed)
        internal
        view
        returns (uint256 packedTraits, uint8 mutationCount)
    {
        TraitIds memory parentA = _decodeTraits(parentTraitsA);
        TraitIds memory parentB = _decodeTraits(parentTraitsB);
        TraitIds memory child = TraitIds({
            background: type(uint8).max,
            breed: type(uint8).max,
            clothes: type(uint8).max,
            mood: type(uint8).max,
            marks: type(uint8).max,
            mouth: type(uint8).max,
            eyes: type(uint8).max,
            accessory: type(uint8).max
        });

        uint8[8] memory order = [uint8(1), 0, 2, 5, 6, 4, 3, 7];
        for (uint8 i = 0; i < 8; i++) {
            (uint8 traitId, bool usedMutation) = _selectGroupTrait(
                order[i],
                _traitFromStruct(parentA, order[i]),
                _traitFromStruct(parentB, order[i]),
                childTier,
                settlementSeed,
                i,
                child
            );
            if (usedMutation) {
                mutationCount += 1;
            }
            _setTraitByGroup(child, order[i], traitId);
        }
        if (!_isCompatible(child)) revert IncompatibleChildTraits();
        packedTraits = _encodeTraits(child);
    }

    function _selectGroupTrait(
        uint8 group,
        uint8 parentTraitA,
        uint8 parentTraitB,
        uint8 childTier,
        bytes32 settlementSeed,
        uint8 step,
        TraitIds memory partialChild
    ) internal view returns (uint8, bool) {
        (uint16 parentPool, uint16 mutationPool) = _groupPools(group);
        uint256 sourceRoll = uint256(keccak256(abi.encodePacked(settlementSeed, "GROUP_SOURCE", step, group))) % 10_000;
        uint8[3] memory sourceOrder;
        if (sourceRoll < parentPool) {
            sourceOrder = [uint8(0), 1, 2];
        } else if (sourceRoll < parentPool + mutationPool) {
            sourceOrder = [uint8(1), 0, 2];
        } else {
            sourceOrder = [uint8(2), 0, 1];
        }

        CandidateContext memory context;
        context.group = group;
        context.parentTraitA = parentTraitA;
        context.parentTraitB = parentTraitB;
        context.childTier = childTier;
        context.settlementSeed = settlementSeed;
        context.step = step;
        context.partialChild = partialChild;

        for (uint8 s = 0; s < 3; s++) {
            uint8 source = sourceOrder[s];
            if (source == 1 && mutationPool == 0) continue;
            context.source = source;
            (bool ok, uint8 traitId) = _pickCandidate(context);
            if (ok) {
                return (traitId, source == 1);
            }
        }
        // Last-resort fallback when configured pools are too restrictive.
        context.source = 2;
        (bool fallbackOk, uint8 fallbackTraitId) = _pickCandidate(context);
        if (fallbackOk) {
            bool isMutation = fallbackTraitId != parentTraitA && fallbackTraitId != parentTraitB;
            return (fallbackTraitId, isMutation);
        }
        revert IncompatibleChildTraits();
    }

    function _pickCandidate(CandidateContext memory context) internal view returns (bool, uint8) {
        uint8 count = _traitCount(context.group);
        uint256[32] memory weights;
        uint256 totalWeight;
        for (uint8 traitId = 0; traitId < count; traitId++) {
            uint256 weight = _candidateWeight(context, traitId);
            if (weight == 0) continue;
            weights[traitId] = weight;
            totalWeight += weight;
        }
        if (totalWeight == 0) {
            return (false, 0);
        }

        uint256 roll =
            uint256(keccak256(abi.encodePacked(context.settlementSeed, "GROUP_PICK", context.step, context.source)))
                % totalWeight;
        uint256 cursor;
        for (uint8 traitId = 0; traitId < count; traitId++) {
            uint256 weight = weights[traitId];
            if (weight == 0) continue;
            cursor += weight;
            if (roll < cursor) {
                return (true, traitId);
            }
        }
        return (false, 0);
    }

    function _candidateWeight(
        CandidateContext memory context,
        uint8 traitId
    ) internal view returns (uint256) {
        if (context.source == 0) {
            if (traitId != context.parentTraitA && traitId != context.parentTraitB) return 0;
        } else if (context.source == 1) {
            if (traitId == context.parentTraitA || traitId == context.parentTraitB) return 0;
        }

        TraitIds memory probe = context.partialChild;
        _setTraitByGroup(probe, context.group, traitId);
        if (!_isCompatible(probe)) return 0;

        uint16 baseWeight = _weightFor(context.group, context.childTier, traitId);
        if (context.source == 0) {
            baseWeight = 10_000;
            if (context.parentTraitA == context.parentTraitB && traitId == context.parentTraitA) {
                baseWeight = 20_000;
            }
        }
        if (baseWeight == 0) return 0;

        uint16 rarityPenalty = _rarityPenalty(context.group, traitId);
        uint16 dominance = _dominance(context.group, traitId);
        return (uint256(baseWeight) * uint256(rarityPenalty) * uint256(dominance)) / 10_000 / 10_000;
    }

    function _groupPools(uint8 group) internal pure returns (uint16 parentPool, uint16 mutationPool) {
        if (group == 1) return (7200, 800);
        if (group == 6) return (6400, 800);
        if (group == 5) return (5400, 1000);
        if (group == 4) return (5200, 1200);
        if (group == 2) return (3500, 2200);
        if (group == 3) return (3200, 2000);
        if (group == 7) return (2800, 1800);
        return (2200, 2500);
    }

    function _cycleDaysForParent(uint256 kittyId) internal view returns (uint16) {
        (, , uint8 tier, , uint256 packedTraits, bool alive) = token.kitties(kittyId);
        if (!alive) revert InvalidParent();
        TraitIds memory traits = _decodeTraits(packedTraits);

        int16 base = _baseCycleByTier(tier);
        int16 modifierValue = _breedCycleModifier(traits.breed) + _traitCycleModifier(traits);
        if (modifierValue < -3) modifierValue = -3;
        if (modifierValue > 5) modifierValue = 5;

        int16 total = base + modifierValue;
        if (total < 3) total = 3;
        if (total > 21) total = 21;
        return uint16(uint16(total));
    }

    function _baseCycleByTier(uint8 tier) internal pure returns (int16) {
        if (tier == 0) return 6;
        if (tier == 1) return 8;
        if (tier == 2) return 10;
        if (tier == 3) return 14;
        return 18;
    }

    function _breedCycleModifier(uint8 breed) internal pure returns (int16) {
        if (breed == 19) return 4;
        if (breed == 4 || breed == 11) return 2;
        if (breed == 1 || breed == 3 || breed == 8 || breed == 15 || breed == 18) return 1;
        if (breed == 7 || breed == 13) return -1;
        return 0;
    }

    function _traitCycleModifier(TraitIds memory traits) internal pure returns (int16 modifierValue) {
        if (traits.clothes == 12 || traits.accessory == 1 || traits.eyes == 11) modifierValue += 2;
        if (
            traits.clothes == 16
                || traits.clothes == 14
                || traits.clothes == 17
                || traits.clothes == 13
                || traits.mood == 6
                || traits.mood == 9
                || traits.accessory == 11
                || traits.accessory == 15
                || traits.accessory == 10
        ) {
            modifierValue += 1;
        }
        if (
            traits.accessory == 2
                || traits.accessory == 3
                || traits.accessory == 6
                || traits.mood == 2
                || traits.mood == 7
                || traits.mood == 8
                || traits.mouth == 8
                || traits.accessory == 16
                || traits.accessory == 12
                || traits.accessory == 13
        ) {
            modifierValue -= 1;
        }
    }

    function _tierPenalty(uint8 childTier) internal pure returns (uint16) {
        if (childTier == 0) return 0;
        if (childTier == 1) return 300;
        if (childTier == 2) return 700;
        if (childTier == 3) return 1200;
        return 1800;
    }

    function _dominance(uint8 group, uint8 traitId) internal pure returns (uint16) {
        if ((group == 1 && traitId == 19) || (group == 6 && traitId == 11)) return 11_000;
        if ((group == 2 && (traitId == 13 || traitId == 14 || traitId == 16)) || (group == 7 && (traitId == 10 || traitId == 11))) {
            return 10_800;
        }
        if (
            (group == 1 && traitId == 15)
                || (group == 6 && (traitId == 5 || traitId == 10))
                || (group == 5 && traitId == 10)
                || (group == 3 && (traitId == 7 || traitId == 9))
        ) {
            return 10_600;
        }
        if (
            (group == 1 && traitId == 18)
                || (group == 6 && (traitId == 8 || traitId == 9))
                || (group == 5 && traitId == 8)
                || (group == 3 && traitId == 8)
        ) {
            return 10_400;
        }
        if (group == 0 || group == 3) return 9600;
        if (group == 2 || group == 7) return 9800;
        return 10_000;
    }

    function _rarityPenalty(uint8 group, uint8 traitId) internal view returns (uint16) {
        uint16 legendaryWeight = _weightFor(group, 4, traitId);
        if (legendaryWeight <= 3) return 4500;
        if (legendaryWeight <= 5) return 6200;
        if (legendaryWeight <= 8) return 8200;
        if (legendaryWeight <= 12) return 10_000;
        return 10_800;
    }

    function _weightFor(uint8 group, uint8 tier, uint8 traitId) internal view returns (uint16) {
        if (group == 0) return BACKGROUND_WEIGHTS[tier][traitId];
        if (group == 1) return BREED_WEIGHTS[tier][traitId];
        if (group == 2) return CLOTHES_WEIGHTS[tier][traitId];
        if (group == 3) return MOOD_WEIGHTS[tier][traitId];
        if (group == 4) return MARK_WEIGHTS[tier][traitId];
        if (group == 5) return MOUTH_WEIGHTS[tier][traitId];
        if (group == 6) return EYES_WEIGHTS[tier][traitId];
        return ACCESSORY_WEIGHTS[tier][traitId];
    }

    function _traitCount(uint8 group) internal pure returns (uint8) {
        if (group == 0) return BACKGROUND_COUNT;
        if (group == 1) return BREED_COUNT;
        if (group == 2) return CLOTHES_COUNT;
        if (group == 3) return MOOD_COUNT;
        if (group == 4) return MARK_COUNT;
        if (group == 5) return MOUTH_COUNT;
        if (group == 6) return EYE_COUNT;
        return ACCESSORY_COUNT;
    }

    function _matchesFilters(Pool storage pool, TraitIds memory traits) internal view returns (bool) {
        for (uint8 i = 0; i < pool.filterCount; i++) {
            if (_traitFromStruct(traits, pool.filterGroups[i]) != pool.filterTraits[i]) {
                return false;
            }
        }
        return true;
    }

    function _parentTraits(uint256 kittyId) internal view returns (uint8 tier, uint256 traits) {
        bool alive;
        (, , tier, , traits, alive) = token.kitties(kittyId);
        if (!alive) revert InvalidParent();
    }

    function _releaseParent(uint256 kittyId, address to) internal {
        if (kittyId == 0) return;
        delete kittyPool[kittyId];
        token.directTransferKitty(kittyId, to);
    }

    function _revertIfCoolingDown(uint256 parentId) internal view {
        if (parentCooldownUntil[parentId] > block.timestamp) revert ParentCoolingDown();
    }

    function _pairKey(uint256 parentA, uint256 parentB) internal pure returns (bytes32) {
        return parentA < parentB ? keccak256(abi.encodePacked(parentA, parentB)) : keccak256(abi.encodePacked(parentB, parentA));
    }

    function _traitByGroup(uint256 packedTraits, uint8 group) internal pure returns (uint8) {
        if (group == 0) return uint8(packedTraits & 0xff);
        if (group == 1) return uint8((packedTraits >> 8) & 0xff);
        if (group == 2) return uint8((packedTraits >> 16) & 0xff);
        if (group == 3) return uint8((packedTraits >> 24) & 0xff);
        if (group == 4) return uint8((packedTraits >> 32) & 0xff);
        if (group == 5) return uint8((packedTraits >> 40) & 0xff);
        if (group == 6) return uint8((packedTraits >> 48) & 0xff);
        return uint8((packedTraits >> 56) & 0xff);
    }

    function _traitFromStruct(TraitIds memory traits, uint8 group) internal pure returns (uint8) {
        if (group == 0) return traits.background;
        if (group == 1) return traits.breed;
        if (group == 2) return traits.clothes;
        if (group == 3) return traits.mood;
        if (group == 4) return traits.marks;
        if (group == 5) return traits.mouth;
        if (group == 6) return traits.eyes;
        return traits.accessory;
    }

    function _setTraitByGroup(TraitIds memory traits, uint8 group, uint8 traitId) internal pure {
        if (group == 0) {
            traits.background = traitId;
        } else if (group == 1) {
            traits.breed = traitId;
        } else if (group == 2) {
            traits.clothes = traitId;
        } else if (group == 3) {
            traits.mood = traitId;
        } else if (group == 4) {
            traits.marks = traitId;
        } else if (group == 5) {
            traits.mouth = traitId;
        } else if (group == 6) {
            traits.eyes = traitId;
        } else {
            traits.accessory = traitId;
        }
    }

    function _decodeTraits(uint256 packed) internal pure returns (TraitIds memory) {
        return TraitIds({
            background: uint8(packed & 0xff),
            breed: uint8((packed >> 8) & 0xff),
            clothes: uint8((packed >> 16) & 0xff),
            mood: uint8((packed >> 24) & 0xff),
            marks: uint8((packed >> 32) & 0xff),
            mouth: uint8((packed >> 40) & 0xff),
            eyes: uint8((packed >> 48) & 0xff),
            accessory: uint8((packed >> 56) & 0xff)
        });
    }

    function _encodeTraits(TraitIds memory ids) internal pure returns (uint256 packed) {
        packed |= uint256(ids.background);
        packed |= uint256(ids.breed) << 8;
        packed |= uint256(ids.clothes) << 16;
        packed |= uint256(ids.mood) << 24;
        packed |= uint256(ids.marks) << 32;
        packed |= uint256(ids.mouth) << 40;
        packed |= uint256(ids.eyes) << 48;
        packed |= uint256(ids.accessory) << 56;
    }

    function _isCompatible(TraitIds memory ids) internal pure returns (bool) {
        // Range checks for selected fields.
        if (ids.background != type(uint8).max && ids.background >= BACKGROUND_COUNT) return false;
        if (ids.breed != type(uint8).max && ids.breed >= BREED_COUNT) return false;
        if (ids.clothes != type(uint8).max && ids.clothes >= CLOTHES_COUNT) return false;
        if (ids.mood != type(uint8).max && ids.mood >= MOOD_COUNT) return false;
        if (ids.marks != type(uint8).max && ids.marks >= MARK_COUNT) return false;
        if (ids.mouth != type(uint8).max && ids.mouth >= MOUTH_COUNT) return false;
        if (ids.eyes != type(uint8).max && ids.eyes >= EYE_COUNT) return false;
        if (ids.accessory != type(uint8).max && ids.accessory >= ACCESSORY_COUNT) return false;

        if (ids.breed != type(uint8).max && ids.background != type(uint8).max && !_isBackgroundAllowed(ids.breed, ids.background)) return false;
        if (ids.breed != type(uint8).max && ids.clothes != type(uint8).max && !_isClothesAllowed(ids.breed, ids.clothes)) return false;
        if (ids.breed != type(uint8).max && ids.mouth != type(uint8).max && !_isMouthAllowed(ids.breed, ids.mouth)) return false;
        if (
            ids.breed != type(uint8).max && ids.clothes != type(uint8).max && ids.accessory != type(uint8).max
                && !_isAccessoryAllowed(ids.breed, ids.clothes, ids.accessory)
        ) return false;
        if (ids.mouth != type(uint8).max && ids.background != type(uint8).max && ids.mood != type(uint8).max && !_isMoodAllowed(ids.mouth, ids.background, ids.mood)) return false;
        if (ids.breed != type(uint8).max && ids.clothes != type(uint8).max && ids.marks != type(uint8).max && !_isMarkAllowed(ids.breed, ids.clothes, ids.marks)) return false;
        return true;
    }

    function _isBackgroundAllowed(uint8 breed, uint8 background) internal pure returns (bool) {
        if ((breed == 2 || breed == 8 || breed == 9) && background == 0) return false;
        if (breed == 10 && background == 5) return false;
        return true;
    }

    function _isClothesAllowed(uint8 breed, uint8 clothes) internal pure returns (bool) {
        if (breed == 12 && clothes == 6) return false;
        if (breed == 15 && (clothes == 4 || clothes == 5 || clothes == 6 || clothes == 8 || clothes == 9 || clothes == 10)) return false;
        if (breed == 18 && clothes == 6) return false;
        if (breed == 19 && (clothes == 4 || clothes == 5 || clothes == 6 || clothes == 7 || clothes == 9 || clothes == 10)) return false;
        if (clothes == 13 && (breed == 2 || breed == 3 || breed == 8 || breed == 15 || breed == 19)) return false;
        if ((clothes == 14 || clothes == 15 || clothes == 16) && (breed == 2 || breed == 3 || breed == 8 || breed == 19)) return false;
        if (clothes == 17 && (breed == 10 || breed == 13 || breed == 15 || breed == 19)) return false;
        return true;
    }

    function _isMouthAllowed(uint8 breed, uint8 mouth) internal pure returns (bool) {
        if (breed == 15 && (mouth == 0 || mouth == 6)) return false;
        if (breed == 19 && mouth == 0) return false;
        return true;
    }

    function _isAccessoryAllowed(uint8 breed, uint8 clothes, uint8 accessory) internal pure returns (bool) {
        if (clothes == 12) {
            return accessory == 0;
        }
        if (accessory == 1 && (clothes == 6 || clothes == 7 || clothes == 12)) {
            return false;
        }
        if (
            (accessory == 4 || accessory == 6 || accessory == 7 || accessory == 8)
                && (clothes == 1 || clothes == 2 || clothes == 3 || clothes == 8 || clothes == 11)
        ) {
            return false;
        }
        if (breed == 15 && (accessory == 4 || accessory == 6)) {
            return false;
        }
        return true;
    }

    function _isMoodAllowed(uint8 mouth, uint8 background, uint8 mood) internal pure returns (bool) {
        if (mood == 3 && (mouth == 0 || mouth == 5)) return false;
        if (mood == 10 && background != 4 && background != 5) return false;
        return true;
    }

    function _isMarkAllowed(uint8 breed, uint8 clothes, uint8 marks) internal pure returns (bool) {
        if ((breed == 15 || breed == 17 || breed == 19) && marks == 2) return false;
        if (clothes == 12) {
            return marks == 0 || marks == 1 || marks == 2;
        }
        return true;
    }

    function _max(uint16 a, uint16 b) internal pure returns (uint16) {
        return a >= b ? a : b;
    }

    function _min(uint16 a, uint16 b) internal pure returns (uint16) {
        return a <= b ? a : b;
    }

    uint16[20][5] private BREED_WEIGHTS = [
        [uint16(13), 12, 6, 8, 5, 3, 8, 8, 2, 6, 6, 2, 6, 2, 4, 1, 4, 3, 1, 0],
        [uint16(9), 8, 7, 7, 7, 5, 6, 6, 5, 6, 5, 4, 6, 3, 4, 2, 4, 3, 2, 1],
        [uint16(6), 6, 8, 5, 8, 8, 5, 5, 7, 7, 4, 6, 5, 3, 4, 2, 3, 3, 4, 1],
        [uint16(5), 5, 7, 5, 7, 9, 4, 3, 7, 6, 4, 10, 5, 3, 4, 2, 3, 3, 5, 3],
        [uint16(3), 3, 8, 4, 8, 12, 2, 2, 10, 6, 3, 12, 5, 3, 4, 2, 3, 2, 5, 3]
    ];

    uint16[18][5] private CLOTHES_WEIGHTS = [
        [uint16(30), 15, 13, 10, 7, 7, 4, 3, 4, 3, 2, 1, 1, 0, 0, 0, 0, 0],
        [uint16(23), 13, 11, 9, 8, 8, 5, 4, 5, 4, 3, 1, 1, 1, 1, 1, 1, 1],
        [uint16(19), 11, 9, 8, 8, 8, 6, 5, 6, 5, 4, 2, 1, 2, 2, 2, 1, 1],
        [uint16(14), 9, 8, 7, 7, 7, 7, 6, 7, 6, 5, 2, 2, 3, 3, 3, 2, 2],
        [uint16(12), 7, 7, 6, 6, 7, 7, 8, 6, 5, 5, 3, 3, 4, 4, 4, 3, 3]
    ];

    uint16[12][5] private MOOD_WEIGHTS = [
        [uint16(47), 9, 7, 11, 10, 7, 2, 3, 3, 1, 0, 0],
        [uint16(42), 9, 8, 10, 10, 8, 4, 4, 3, 1, 1, 0],
        [uint16(34), 8, 8, 10, 9, 10, 7, 5, 4, 2, 2, 1],
        [uint16(28), 7, 7, 9, 8, 12, 11, 6, 4, 3, 3, 2],
        [uint16(23), 6, 6, 8, 7, 14, 14, 6, 4, 4, 5, 3]
    ];

    uint16[4][5] private MARK_WEIGHTS = [
        [uint16(56), 20, 18, 6],
        [uint16(48), 24, 19, 9],
        [uint16(40), 26, 20, 14],
        [uint16(34), 26, 20, 20],
        [uint16(30), 25, 20, 25]
    ];

    uint16[12][5] private MOUTH_WEIGHTS = [
        [uint16(23), 20, 12, 15, 6, 6, 4, 3, 7, 1, 1, 2],
        [uint16(20), 18, 12, 14, 8, 8, 4, 3, 6, 2, 2, 3],
        [uint16(17), 16, 12, 12, 11, 11, 4, 3, 5, 3, 3, 3],
        [uint16(14), 14, 11, 10, 14, 15, 4, 4, 4, 3, 4, 3],
        [uint16(11), 12, 10, 8, 16, 18, 4, 4, 4, 3, 5, 5]
    ];

    uint16[12][5] private EYES_WEIGHTS = [
        [uint16(24), 18, 14, 15, 14, 3, 4, 4, 2, 1, 1, 0],
        [uint16(22), 17, 13, 14, 12, 4, 5, 6, 3, 2, 2, 0],
        [uint16(18), 15, 12, 13, 10, 6, 7, 9, 3, 3, 3, 1],
        [uint16(14), 13, 11, 12, 9, 7, 8, 11, 3, 4, 5, 3],
        [uint16(11), 12, 9, 12, 8, 9, 10, 14, 2, 5, 5, 3]
    ];

    uint16[17][5] private ACCESSORY_WEIGHTS = [
        [uint16(39), 4, 17, 0, 7, 9, 7, 5, 3, 0, 0, 0, 5, 1, 0, 0, 3],
        [uint16(30), 4, 13, 4, 6, 8, 8, 7, 7, 1, 0, 1, 5, 2, 1, 1, 2],
        [uint16(22), 4, 9, 7, 5, 7, 8, 10, 10, 2, 1, 2, 4, 3, 2, 2, 2],
        [uint16(14), 5, 7, 8, 4, 6, 9, 11, 12, 3, 2, 3, 3, 5, 3, 3, 2],
        [uint16(10), 5, 6, 8, 3, 5, 8, 12, 14, 4, 3, 4, 2, 5, 4, 4, 3]
    ];

    uint16[6][5] private BACKGROUND_WEIGHTS = [
        [uint16(28), 22, 22, 16, 8, 4],
        [uint16(24), 21, 21, 16, 10, 8],
        [uint16(20), 20, 20, 16, 12, 12],
        [uint16(18), 19, 19, 16, 13, 15],
        [uint16(16), 19, 19, 16, 14, 16]
    ];
}
