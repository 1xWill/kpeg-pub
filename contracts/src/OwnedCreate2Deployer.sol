// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract OwnedCreate2Deployer {
    error EmptyBytecode();
    error DeployFailed();
    error OnlyOwner();
    error ZeroOwner();

    address public owner;

    event Deployed(address indexed deployed, bytes32 indexed salt);
    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroOwner();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    function computeAddress(bytes32 salt, bytes32 initCodeHash) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }

    function deployCode(bytes32 salt, bytes memory creationCode) external onlyOwner returns (address deployed) {
        if (creationCode.length == 0) revert EmptyBytecode();

        assembly ("memory-safe") {
            deployed := create2(0, add(creationCode, 0x20), mload(creationCode), salt)
        }

        if (deployed == address(0)) revert DeployFailed();
        emit Deployed(deployed, salt);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroOwner();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
