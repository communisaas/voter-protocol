// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Script.sol";

/// @title TransferGovernanceToSafe
/// @notice Transfers governance of all 9 TimelockGovernance contracts to a Gnosis Safe multisig.
/// @dev Two-phase process: InitiateTransfer starts the governance timelock on all contracts,
///      ExecuteTransfer finalizes after the timelock expires.
///
/// CONTRACTS COVERED (all inherit TimelockGovernance):
///   1. DistrictRegistry
///   2. NullifierRegistry
///   3. VerifierRegistry
///   4. DistrictGate          (also Pausable, ReentrancyGuard)
///   5. CampaignRegistry      (also Pausable, ReentrancyGuard)
///   6. UserRootRegistry
///   7. CellMapRegistry
///   8. EngagementRootRegistry
///   9. DebateMarket           (also Pausable, ReentrancyGuard)
///
/// ENVIRONMENT VARIABLES:
///   PRIVATE_KEY                       — Deployer/governance private key (current governance on all contracts)
///   SAFE_ADDRESS                      — Gnosis Safe multisig address (transfer target)
///   DISTRICT_REGISTRY_ADDRESS         — DistrictRegistry contract address
///   NULLIFIER_REGISTRY_ADDRESS        — NullifierRegistry contract address
///   VERIFIER_REGISTRY_ADDRESS         — VerifierRegistry contract address
///   DISTRICT_GATE_ADDRESS             — DistrictGate contract address
///   CAMPAIGN_REGISTRY_ADDRESS         — CampaignRegistry contract address
///   USER_ROOT_REGISTRY_ADDRESS        — UserRootRegistry contract address
///   CELL_MAP_REGISTRY_ADDRESS         — CellMapRegistry contract address
///   ENGAGEMENT_ROOT_REGISTRY_ADDRESS  — EngagementRootRegistry contract address
///   DEBATE_MARKET_ADDRESS             — DebateMarket contract address
///
/// USAGE:
///
///   Phase 1 — Initiate (starts 7-day timelock on all 9 contracts):
///
///     cd contracts
///     forge script script/TransferGovernanceToSafe.s.sol:InitiateTransfer \
///       --rpc-url scroll_sepolia --private-key $PRIVATE_KEY --broadcast --slow
///
///   Phase 2 — Execute (after 7 days have elapsed):
///
///     cd contracts
///     forge script script/TransferGovernanceToSafe.s.sol:ExecuteTransfer \
///       --rpc-url scroll_sepolia --private-key $PRIVATE_KEY --broadcast --slow
///
/// SAFETY NOTES:
///   - The 7-day timelock window gives the community time to monitor and respond.
///   - GovernanceTransferInitiated events are emitted on each contract — monitor these.
///   - Governance can cancel any pending transfer via cancelGovernanceTransfer(address)
///     during the 7-day window if something goes wrong.
///   - After execution, the deployer EOA loses all governance privileges.
///   - The Safe must sign all future governance transactions via multisig.
///
/// SAFE DEPLOYMENT (Scroll Sepolia testnet):
///   1. Go to https://app.safe.global
///   2. Connect deployer wallet, select Scroll Sepolia network
///   3. Create new Safe with 3-of-5 threshold
///   4. Recommended testnet signer set:
///      - Signer 1: Deployer EOA (0xe8a1fe0D0ecf014398BeD78186df8F541753C6e2)
///      - Signers 2-5: Generate 4 test addresses (cast wallet new)
///   5. Record the deployed Safe address and set SAFE_ADDRESS env var

/// @dev Minimal interface for TimelockGovernance calls — avoids importing full contracts
interface ITimelockGovernance {
    function initiateGovernanceTransfer(address newGovernance) external;
    function executeGovernanceTransfer(address newGovernance) external;
    function governance() external view returns (address);
    function pendingGovernance(address target) external view returns (uint256);
}

/// @title InitiateTransfer
/// @notice Phase 1: Calls initiateGovernanceTransfer(safeAddress) on all 9 contracts.
///         Each call starts a 7-day timelock. Must be called by the current governance EOA.
contract InitiateTransfer is Script {
    uint256 constant GOVERNANCE_TIMELOCK = 10 minutes;

    string[9] internal CONTRACT_NAMES = [
        "DistrictRegistry",
        "NullifierRegistry",
        "VerifierRegistry",
        "DistrictGate",
        "CampaignRegistry",
        "UserRootRegistry",
        "CellMapRegistry",
        "EngagementRootRegistry",
        "DebateMarket"
    ];

    string[9] internal ENV_VARS = [
        "DISTRICT_REGISTRY_ADDRESS",
        "NULLIFIER_REGISTRY_ADDRESS",
        "VERIFIER_REGISTRY_ADDRESS",
        "DISTRICT_GATE_ADDRESS",
        "CAMPAIGN_REGISTRY_ADDRESS",
        "USER_ROOT_REGISTRY_ADDRESS",
        "CELL_MAP_REGISTRY_ADDRESS",
        "ENGAGEMENT_ROOT_REGISTRY_ADDRESS",
        "DEBATE_MARKET_ADDRESS"
    ];

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address safeAddress = vm.envAddress("SAFE_ADDRESS");

        require(safeAddress != address(0), "SAFE_ADDRESS must be set and non-zero");

        // Load all 9 contract addresses
        address[9] memory contracts;
        for (uint256 i = 0; i < 9; i++) {
            contracts[i] = vm.envAddress(ENV_VARS[i]);
            require(contracts[i] != address(0), string(abi.encodePacked(ENV_VARS[i], " must be set")));
        }

        console.log("============================================================");
        console.log("  INITIATE GOVERNANCE TRANSFER TO SAFE");
        console.log("============================================================");
        console.log("");
        console.log("Deployer (current governance):", deployer);
        console.log("Safe (new governance):        ", safeAddress);
        console.log("");

        // Pre-flight: verify deployer is governance on all 9 contracts
        for (uint256 i = 0; i < 9; i++) {
            address currentGov = ITimelockGovernance(contracts[i]).governance();
            if (currentGov == safeAddress) {
                console.log(string(abi.encodePacked(
                    "  ", CONTRACT_NAMES[i], ": ALREADY governed by Safe - skipping"
                )));
            } else {
                require(
                    currentGov == deployer,
                    string(abi.encodePacked(
                        CONTRACT_NAMES[i],
                        ": governance is not the deployer. Current governance: ",
                        vm.toString(currentGov)
                    ))
                );
            }
        }

        console.log("");
        console.log("Pre-flight passed. Initiating transfers...");
        console.log("");

        uint256 executeTime = block.timestamp + GOVERNANCE_TIMELOCK;
        uint256 initiated = 0;

        vm.startBroadcast(deployerKey);

        for (uint256 i = 0; i < 9; i++) {
            ITimelockGovernance target = ITimelockGovernance(contracts[i]);

            // Skip if already governed by the Safe
            if (target.governance() == safeAddress) {
                continue;
            }

            // Skip if transfer is already pending for this Safe
            uint256 pending = target.pendingGovernance(safeAddress);
            if (pending != 0) {
                console.log(string(abi.encodePacked(
                    "  [", vm.toString(i + 1), "/9] ", CONTRACT_NAMES[i],
                    ": transfer already pending (execute at ", vm.toString(pending), ") - skipping"
                )));
                continue;
            }

            target.initiateGovernanceTransfer(safeAddress);
            initiated++;

            console.log(string(abi.encodePacked(
                "  [", vm.toString(i + 1), "/9] ", CONTRACT_NAMES[i],
                " (", vm.toString(contracts[i]), ")"
            )));
        }

        vm.stopBroadcast();

        console.log("");
        console.log("============================================================");
        console.log("  INITIATION COMPLETE");
        console.log("============================================================");
        console.log("");
        console.log("Contracts initiated:", initiated);
        console.log("Execute timestamp:  ", executeTime);
        console.log("Timelock:            10 minutes");
        console.log("");
        console.log("Next step:");
        console.log("  Wait 10 minutes, then run ExecuteTransfer.");
        console.log("  Monitor GovernanceTransferInitiated events on each contract.");
        console.log("  To cancel: call cancelGovernanceTransfer(safeAddress) on any");
        console.log("  contract from the deployer wallet before the timelock expires.");
        console.log("============================================================");
    }
}

/// @title ExecuteTransfer
/// @notice Phase 2: Calls executeGovernanceTransfer(safeAddress) on all 9 contracts
///         after the 7-day timelock has expired. Can be called by anyone.
contract ExecuteTransfer is Script {
    string[9] internal CONTRACT_NAMES = [
        "DistrictRegistry",
        "NullifierRegistry",
        "VerifierRegistry",
        "DistrictGate",
        "CampaignRegistry",
        "UserRootRegistry",
        "CellMapRegistry",
        "EngagementRootRegistry",
        "DebateMarket"
    ];

    string[9] internal ENV_VARS = [
        "DISTRICT_REGISTRY_ADDRESS",
        "NULLIFIER_REGISTRY_ADDRESS",
        "VERIFIER_REGISTRY_ADDRESS",
        "DISTRICT_GATE_ADDRESS",
        "CAMPAIGN_REGISTRY_ADDRESS",
        "USER_ROOT_REGISTRY_ADDRESS",
        "CELL_MAP_REGISTRY_ADDRESS",
        "ENGAGEMENT_ROOT_REGISTRY_ADDRESS",
        "DEBATE_MARKET_ADDRESS"
    ];

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address safeAddress = vm.envAddress("SAFE_ADDRESS");

        require(safeAddress != address(0), "SAFE_ADDRESS must be set and non-zero");

        // Load all 9 contract addresses
        address[9] memory contracts;
        for (uint256 i = 0; i < 9; i++) {
            contracts[i] = vm.envAddress(ENV_VARS[i]);
            require(contracts[i] != address(0), string(abi.encodePacked(ENV_VARS[i], " must be set")));
        }

        console.log("============================================================");
        console.log("  EXECUTE GOVERNANCE TRANSFER TO SAFE");
        console.log("============================================================");
        console.log("");
        console.log("Safe (new governance):", safeAddress);
        console.log("");

        // Pre-flight: check all timelocks are matured
        bool allReady = true;
        for (uint256 i = 0; i < 9; i++) {
            ITimelockGovernance target = ITimelockGovernance(contracts[i]);
            address currentGov = target.governance();

            if (currentGov == safeAddress) {
                console.log(string(abi.encodePacked(
                    "  ", CONTRACT_NAMES[i], ": ALREADY transferred"
                )));
                continue;
            }

            uint256 execTime = target.pendingGovernance(safeAddress);
            if (execTime == 0) {
                console.log(string(abi.encodePacked(
                    "  ", CONTRACT_NAMES[i], ": NO transfer initiated"
                )));
                allReady = false;
            } else if (block.timestamp < execTime) {
                uint256 remaining = execTime - block.timestamp;
                uint256 days_ = remaining / 1 days;
                uint256 hours_ = (remaining % 1 days) / 1 hours;
                uint256 minutes_ = (remaining % 1 hours) / 1 minutes;
                console.log(string(abi.encodePacked(
                    "  ", CONTRACT_NAMES[i], ": NOT READY - ",
                    vm.toString(days_), "d ", vm.toString(hours_), "h ",
                    vm.toString(minutes_), "m remaining"
                )));
                allReady = false;
            } else {
                console.log(string(abi.encodePacked(
                    "  ", CONTRACT_NAMES[i], ": READY"
                )));
            }
        }

        console.log("");

        require(allReady, "Not all governance transfers are ready. See output above.");

        console.log("All timelocks matured. Executing transfers...");
        console.log("");

        vm.startBroadcast(deployerKey);

        uint256 executed = 0;
        for (uint256 i = 0; i < 9; i++) {
            ITimelockGovernance target = ITimelockGovernance(contracts[i]);

            if (target.governance() == safeAddress) {
                continue;
            }

            target.executeGovernanceTransfer(safeAddress);
            executed++;

            console.log(string(abi.encodePacked(
                "  [", vm.toString(i + 1), "/9] ", CONTRACT_NAMES[i], ": transferred"
            )));
        }

        vm.stopBroadcast();

        // Post-execution verification
        console.log("");
        console.log("Verifying governance state...");

        for (uint256 i = 0; i < 9; i++) {
            address currentGov = ITimelockGovernance(contracts[i]).governance();
            require(
                currentGov == safeAddress,
                string(abi.encodePacked(
                    CONTRACT_NAMES[i], " governance NOT transferred. Current: ",
                    vm.toString(currentGov)
                ))
            );
        }

        console.log("");
        console.log("============================================================");
        console.log("  GOVERNANCE TRANSFER COMPLETE");
        console.log("============================================================");
        console.log("");
        console.log("Contracts transferred:", executed);
        console.log("New governance (Safe):", safeAddress);
        console.log("");
        console.log("All 9 contracts are now governed by the Safe.");
        console.log("The deployer EOA no longer has governance privileges.");
        console.log("All future governance actions require multisig approval.");
        console.log("============================================================");
    }
}
