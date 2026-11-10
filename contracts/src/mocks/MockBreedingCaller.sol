// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IMockBreedingToken {
    function replaceBornKPEG(
        uint256 backingKittyId,
        address childCustody,
        uint8 tier,
        bytes32 seedSalt,
        uint256 packedTraits
    ) external returns (uint256);
}

contract MockBreedingCaller {
    IMockBreedingToken public immutable token;

    constructor(address tokenAddress) {
        token = IMockBreedingToken(tokenAddress);
    }

    function mint(uint256 backingKittyId, address childCustody, uint8 tier, bytes32 seedSalt, uint256 packedTraits)
        external
        returns (uint256)
    {
        return token.replaceBornKPEG(backingKittyId, childCustody, tier, seedSalt, packedTraits);
    }
}
