// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";

contract ExternalContractsAnchor {
    function touch(PositionManager manager)
        external
        pure
        returns (address managerAddress)
    {
        return address(manager);
    }
}
