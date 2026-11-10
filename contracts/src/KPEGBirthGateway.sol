// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IKPEGBirthGatewayToken {
    function replaceBornKPEG(
        uint256 backingKittyId,
        address childCustody,
        uint8 tier,
        bytes32 seedSalt,
        uint256 packedTraits
    ) external returns (uint256);
}

contract KPEGBirthGateway {
    error InvalidChildCustody();
    error NotAuthorizedCaller();
    error OnlyOwner();
    error AuthorizationsFrozen();
    error ZeroAddress();

    address public owner;
    IKPEGBirthGatewayToken public immutable token;
    mapping(address caller => bool allowed) public authorizedCallers;
    bool public authorizationsFrozen;

    event AuthorizedCallerSet(address indexed caller, bool allowed);
    event AuthorizedCallersFrozen();
    event OwnershipRenounced(address indexed previousOwner);

    constructor(address initialOwner, address tokenAddress, address initialAuthorizedCaller) {
        if (initialOwner == address(0) || tokenAddress == address(0)) revert ZeroAddress();
        owner = initialOwner;
        token = IKPEGBirthGatewayToken(tokenAddress);

        if (initialAuthorizedCaller != address(0)) {
            authorizedCallers[initialAuthorizedCaller] = true;
            emit AuthorizedCallerSet(initialAuthorizedCaller, true);
        }
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    function setAuthorizedCaller(address caller, bool allowed) external onlyOwner {
        if (authorizationsFrozen) revert AuthorizationsFrozen();
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = allowed;
        emit AuthorizedCallerSet(caller, allowed);
    }

    function freezeAuthorizations() external onlyOwner {
        if (authorizationsFrozen) revert AuthorizationsFrozen();
        authorizationsFrozen = true;
        emit AuthorizedCallersFrozen();
    }

    function renounceOwnership() external onlyOwner {
        address previousOwner = owner;
        owner = address(0);
        emit OwnershipRenounced(previousOwner);
    }

    function replaceBornKPEG(
        uint256 backingKittyId,
        address childCustody,
        uint8 tier,
        bytes32 seedSalt,
        uint256 packedTraits
    ) external returns (uint256) {
        if (!authorizedCallers[msg.sender]) revert NotAuthorizedCaller();
        // Authorized callers can only consume backing kitties they hold in their own custody.
        if (childCustody != msg.sender) revert InvalidChildCustody();
        return token.replaceBornKPEG(backingKittyId, childCustody, tier, seedSalt, packedTraits);
    }
}
