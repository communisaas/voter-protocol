// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Script.sol";
import "../src/UserRootRegistry.sol";
import "../src/CellMapRegistry.sol";
import "../src/DistrictGate.sol";

/// @title DeployTwoTree
/// @notice DEPRECATED — proposeTwoTreeRegistries/executeTwoTreeRegistries removed in SL-5.
///         UserRoot + CellMap registries are now set via setRegistriesGenesis() during genesis.
///         This script is retained for historical reference only.
contract DeployTwoTree is Script {
    function run() external pure {
        revert("DeployTwoTree is deprecated. Use setRegistriesGenesis() during genesis.");
    }
}
