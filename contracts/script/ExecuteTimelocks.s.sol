// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Script.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";
import "../src/DistrictGate.sol";
import "../src/CampaignRegistry.sol";

/// @title ExecuteTimelocks
/// @notice Post-deployment script to execute timelocked operations after their windows expire
/// @dev Run this script after the mainnet deploy (DeployScrollMainnet.s.sol) once timelocks mature.
///
/// OPERATION SEQUENCE:
///   Step 1 — Execute DistrictGate caller authorization on NullifierRegistry (7 days after deploy)
///   Step 2 — Propose CampaignRegistry on DistrictGate (requires step 1 complete; onlyGovernance)
///   Step 3 — Execute CampaignRegistry integration on DistrictGate (7 days after step 2)
///   governance — Execute governance transfer on all 5 contracts (7 days after initiateGovernanceTransfer)
///
/// USAGE:
///   STEP=1 forge script script/ExecuteTimelocks.s.sol:ExecuteTimelocks \
///     --rpc-url scroll_mainnet --private-key $PRIVATE_KEY --broadcast --slow
///
/// ENVIRONMENT VARIABLES:
///   PRIVATE_KEY          — Deployer/governance private key
///   DISTRICT_GATE        — DistrictGate contract address
///   NULLIFIER_REGISTRY   — NullifierRegistry address
///   CAMPAIGN_REGISTRY    — CampaignRegistry address
///   VERIFIER_REGISTRY    — VerifierRegistry address (governance transfer only)
///   DISTRICT_REGISTRY    — DistrictRegistry address (governance transfer only)
///   STEP                 — Which step to execute: "1", "2", "3", or "governance"
///   NEW_GOVERNANCE       — New governance address (governance step only)
///   SCROLL_NETWORK       — "mainnet" (default) or "sepolia"
contract ExecuteTimelocks is Script {
    // =========================================================================
    // Constants
    // =========================================================================

    uint256 constant SCROLL_MAINNET_CHAIN_ID = 534352;
    uint256 constant SCROLL_SEPOLIA_CHAIN_ID = 534351;

    // =========================================================================
    // Entry Point
    // =========================================================================

    function run() external {
        // -----------------------------------------------------------------
        // Chain ID validation
        // -----------------------------------------------------------------
        string memory network = "mainnet";
        try vm.envString("SCROLL_NETWORK") returns (string memory n) {
            network = n;
        } catch {}

        uint256 expectedChainId;
        if (keccak256(bytes(network)) == keccak256(bytes("sepolia"))) {
            expectedChainId = SCROLL_SEPOLIA_CHAIN_ID;
        } else {
            expectedChainId = SCROLL_MAINNET_CHAIN_ID;
        }

        require(
            block.chainid == expectedChainId,
            string(abi.encodePacked(
                "WRONG NETWORK: expected chain ID ",
                vm.toString(expectedChainId),
                " but got ",
                vm.toString(block.chainid)
            ))
        );

        // -----------------------------------------------------------------
        // Determine step
        // -----------------------------------------------------------------
        string memory step = vm.envString("STEP");
        bytes32 stepHash = keccak256(bytes(step));

        console.log("============================================================");
        console.log("  EXECUTE TIMELOCKS - VOTER PROTOCOL");
        console.log("============================================================");
        console.log("");
        console.log("Network:  ", network);
        console.log("Chain ID: ", block.chainid);
        console.log("Step:     ", step);
        console.log("");

        if (stepHash == keccak256(bytes("1"))) {
            _executeStep1();
        } else if (stepHash == keccak256(bytes("2"))) {
            _executeStep2();
        } else if (stepHash == keccak256(bytes("3"))) {
            _executeStep3();
        } else if (stepHash == keccak256(bytes("governance"))) {
            _executeGovernanceTransfer();
        } else {
            revert(string(abi.encodePacked(
                "Invalid STEP: '", step, "'. Must be '1', '2', '3', or 'governance'"
            )));
        }
    }

    // =========================================================================
    // Step 1: Execute DistrictGate caller authorization on NullifierRegistry
    // =========================================================================

    function _executeStep1() internal {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address gateAddr = vm.envAddress("DISTRICT_GATE");
        address nullifierAddr = vm.envAddress("NULLIFIER_REGISTRY");

        NullifierRegistry nullifierRegistry = NullifierRegistry(nullifierAddr);

        console.log("[Step 1] Execute caller authorization for DistrictGate on NullifierRegistry");
        console.log("  NullifierRegistry:", nullifierAddr);
        console.log("  DistrictGate:     ", gateAddr);
        console.log("");

        // Check if already authorized
        if (nullifierRegistry.authorizedCallers(gateAddr)) {
            console.log("  STATUS: DistrictGate is ALREADY authorized. Nothing to do.");
            return;
        }

        // Check if proposal exists
        uint256 executeTime = nullifierRegistry.pendingCallerAuthorization(gateAddr);
        if (executeTime == 0) {
            revert("No pending caller authorization for DistrictGate. Did the deploy script run proposeCallerAuthorization?");
        }

        // Check if timelock has matured
        if (block.timestamp < executeTime) {
            uint256 remaining = executeTime - block.timestamp;
            uint256 hours_ = remaining / 1 hours;
            uint256 minutes_ = (remaining % 1 hours) / 1 minutes;
            console.log("  STATUS: Timelock NOT ready.");
            console.log("  Execute time:", executeTime);
            console.log("  Current time:", block.timestamp);
            console.log("  Remaining:   ", remaining, "seconds");
            console.log(string(abi.encodePacked(
                "               ", vm.toString(hours_), "h ", vm.toString(minutes_), "m"
            )));
            revert(string(abi.encodePacked(
                "Timelock not expired. ",
                vm.toString(remaining),
                " seconds remaining (~",
                vm.toString(hours_),
                "h ",
                vm.toString(minutes_),
                "m)"
            )));
        }

        console.log("  STATUS: Timelock matured. Executing...");

        vm.startBroadcast(deployerKey);
        nullifierRegistry.executeCallerAuthorization(gateAddr);
        vm.stopBroadcast();

        // Verify
        require(
            nullifierRegistry.authorizedCallers(gateAddr),
            "Post-execution check failed: DistrictGate not authorized"
        );

        console.log("");
        console.log("  DONE: DistrictGate is now an authorized caller on NullifierRegistry.");
        console.log("");
        console.log("  Next: Run STEP=2 to propose CampaignRegistry on DistrictGate.");
    }

    // =========================================================================
    // Step 2: Propose CampaignRegistry on DistrictGate (onlyGovernance)
    // =========================================================================

    function _executeStep2() internal {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address gateAddr = vm.envAddress("DISTRICT_GATE");
        address campaignAddr = vm.envAddress("CAMPAIGN_REGISTRY");

        DistrictGate gate = DistrictGate(gateAddr);

        console.log("[Step 2] Propose CampaignRegistry on DistrictGate");
        console.log("  DistrictGate:     ", gateAddr);
        console.log("  CampaignRegistry: ", campaignAddr);
        console.log("");

        // Check if campaign registry is already set
        if (address(gate.campaignRegistry()) == campaignAddr) {
            console.log("  STATUS: CampaignRegistry is ALREADY set. Nothing to do.");
            return;
        }

        // Check if a proposal is already pending
        if (gate.pendingCampaignRegistryExecuteTime() != 0) {
            address pending = gate.pendingCampaignRegistry();
            uint256 execTime = gate.pendingCampaignRegistryExecuteTime();
            console.log("  STATUS: A proposal is already pending.");
            console.log("  Pending address:", pending);
            console.log("  Execute time:   ", execTime);
            if (pending == campaignAddr) {
                console.log("");
                console.log("  The pending proposal matches the target. Run STEP=3 after timelock expires.");
            } else {
                console.log("");
                console.log("  WARNING: Pending proposal is for a DIFFERENT address!");
                console.log("  Cancel the existing proposal first, then re-run STEP=2.");
            }
            return;
        }

        // Check that DistrictGate caller authorization is complete (Step 1 prerequisite)
        NullifierRegistry nullifierRegistry = gate.nullifierRegistry();
        if (!nullifierRegistry.authorizedCallers(gateAddr)) {
            revert("Prerequisite not met: DistrictGate is not an authorized caller on NullifierRegistry. Run STEP=1 first.");
        }

        // Verify caller is governance
        address deployer = vm.addr(deployerKey);
        require(
            gate.governance() == deployer,
            "Caller is not governance on DistrictGate. Only governance can propose."
        );

        console.log("  STATUS: Prerequisites met. Proposing CampaignRegistry (7-day timelock)...");

        vm.startBroadcast(deployerKey);
        gate.proposeCampaignRegistry(campaignAddr);
        vm.stopBroadcast();

        uint256 newExecTime = gate.pendingCampaignRegistryExecuteTime();
        console.log("");
        console.log("  DONE: CampaignRegistry proposed.");
        console.log("  Execute time:", newExecTime);
        console.log("  Earliest execution: ", newExecTime, "(unix timestamp)");
        console.log("");
        console.log("  Next: Run STEP=3 after 7 days to execute the CampaignRegistry integration.");
    }

    // =========================================================================
    // Step 3: Execute CampaignRegistry integration on DistrictGate
    // =========================================================================

    function _executeStep3() internal {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address gateAddr = vm.envAddress("DISTRICT_GATE");
        address campaignAddr = vm.envAddress("CAMPAIGN_REGISTRY");

        DistrictGate gate = DistrictGate(gateAddr);

        console.log("[Step 3] Execute CampaignRegistry on DistrictGate");
        console.log("  DistrictGate:     ", gateAddr);
        console.log("  CampaignRegistry: ", campaignAddr);
        console.log("");

        // Check if already set
        if (address(gate.campaignRegistry()) == campaignAddr) {
            console.log("  STATUS: CampaignRegistry is ALREADY set. Nothing to do.");
            return;
        }

        // Check if proposal exists
        uint256 executeTime = gate.pendingCampaignRegistryExecuteTime();
        if (executeTime == 0) {
            revert("No pending CampaignRegistry proposal. Run STEP=2 first.");
        }

        // Validate pending address matches expected
        address pending = gate.pendingCampaignRegistry();
        require(
            pending == campaignAddr,
            string(abi.encodePacked(
                "Pending CampaignRegistry address (",
                vm.toString(pending),
                ") does not match CAMPAIGN_REGISTRY env var (",
                vm.toString(campaignAddr),
                ")"
            ))
        );

        // Check if timelock has matured
        if (block.timestamp < executeTime) {
            uint256 remaining = executeTime - block.timestamp;
            uint256 hours_ = remaining / 1 hours;
            uint256 minutes_ = (remaining % 1 hours) / 1 minutes;
            console.log("  STATUS: Timelock NOT ready.");
            console.log("  Execute time:", executeTime);
            console.log("  Current time:", block.timestamp);
            console.log("  Remaining:   ", remaining, "seconds");
            console.log(string(abi.encodePacked(
                "               ", vm.toString(hours_), "h ", vm.toString(minutes_), "m"
            )));
            revert(string(abi.encodePacked(
                "Timelock not expired. ",
                vm.toString(remaining),
                " seconds remaining (~",
                vm.toString(hours_),
                "h ",
                vm.toString(minutes_),
                "m)"
            )));
        }

        console.log("  STATUS: Timelock matured. Executing...");

        vm.startBroadcast(deployerKey);
        gate.executeCampaignRegistry();
        vm.stopBroadcast();

        // Verify
        require(
            address(gate.campaignRegistry()) == campaignAddr,
            "Post-execution check failed: CampaignRegistry not set"
        );

        console.log("");
        console.log("  DONE: CampaignRegistry is now active on DistrictGate.");
        console.log("  All post-deployment timelock operations are complete.");
    }

    // =========================================================================
    // Governance Transfer: Execute on all 5 contracts
    // =========================================================================

    function _executeGovernanceTransfer() internal {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address gateAddr = vm.envAddress("DISTRICT_GATE");
        address nullifierAddr = vm.envAddress("NULLIFIER_REGISTRY");
        address campaignAddr = vm.envAddress("CAMPAIGN_REGISTRY");
        address verifierAddr = vm.envAddress("VERIFIER_REGISTRY");
        address districtAddr = vm.envAddress("DISTRICT_REGISTRY");
        address newGovernance = vm.envAddress("NEW_GOVERNANCE");

        require(newGovernance != address(0), "NEW_GOVERNANCE must be set");

        DistrictGate gate = DistrictGate(gateAddr);
        NullifierRegistry nullifierRegistry = NullifierRegistry(nullifierAddr);
        CampaignRegistry campaignRegistry = CampaignRegistry(campaignAddr);
        VerifierRegistry verifierRegistry = VerifierRegistry(verifierAddr);
        DistrictRegistry districtRegistry = DistrictRegistry(districtAddr);

        console.log("[Governance] Execute governance transfer on all 5 contracts");
        console.log("  New governance:    ", newGovernance);
        console.log("  DistrictGate:      ", gateAddr);
        console.log("  NullifierRegistry: ", nullifierAddr);
        console.log("  CampaignRegistry:  ", campaignAddr);
        console.log("  VerifierRegistry:  ", verifierAddr);
        console.log("  DistrictRegistry:  ", districtAddr);
        console.log("");

        // Track which contracts are ready vs not ready
        bool allReady = true;

        // -----------------------------------------------------------------
        // Check each contract's timelock status
        // -----------------------------------------------------------------

        // 1. DistrictGate (inherits TimelockGovernance)
        {
            bool alreadyTransferred = gate.governance() == newGovernance;
            if (alreadyTransferred) {
                console.log("  DistrictGate:      ALREADY transferred");
            } else {
                uint256 delay = gate.getGovernanceTransferDelay(newGovernance);
                uint256 execTime = gate.pendingGovernance(newGovernance);
                if (execTime == 0) {
                    console.log("  DistrictGate:      NO transfer initiated");
                    allReady = false;
                } else if (delay > 0) {
                    _logTimelockNotReady("DistrictGate", delay);
                    allReady = false;
                } else {
                    console.log("  DistrictGate:      READY");
                }
            }
        }

        // 2. NullifierRegistry (overrides executeGovernanceTransfer)
        {
            bool alreadyTransferred = nullifierRegistry.governance() == newGovernance;
            if (alreadyTransferred) {
                console.log("  NullifierRegistry: ALREADY transferred");
            } else {
                uint256 delay = nullifierRegistry.getGovernanceTransferDelay(newGovernance);
                uint256 execTime = nullifierRegistry.pendingGovernance(newGovernance);
                if (execTime == 0) {
                    console.log("  NullifierRegistry: NO transfer initiated");
                    allReady = false;
                } else if (delay > 0) {
                    _logTimelockNotReady("NullifierRegistry", delay);
                    allReady = false;
                } else {
                    console.log("  NullifierRegistry: READY");
                }
            }
        }

        // 3. CampaignRegistry (inherits TimelockGovernance)
        {
            bool alreadyTransferred = campaignRegistry.governance() == newGovernance;
            if (alreadyTransferred) {
                console.log("  CampaignRegistry:  ALREADY transferred");
            } else {
                uint256 delay = campaignRegistry.getGovernanceTransferDelay(newGovernance);
                uint256 execTime = campaignRegistry.pendingGovernance(newGovernance);
                if (execTime == 0) {
                    console.log("  CampaignRegistry:  NO transfer initiated");
                    allReady = false;
                } else if (delay > 0) {
                    _logTimelockNotReady("CampaignRegistry", delay);
                    allReady = false;
                } else {
                    console.log("  CampaignRegistry:  READY");
                }
            }
        }

        // 4. VerifierRegistry (inherits TimelockGovernance)
        {
            bool alreadyTransferred = verifierRegistry.governance() == newGovernance;
            if (alreadyTransferred) {
                console.log("  VerifierRegistry:  ALREADY transferred");
            } else {
                uint256 delay = verifierRegistry.getGovernanceTransferDelay(newGovernance);
                uint256 execTime = verifierRegistry.pendingGovernance(newGovernance);
                if (execTime == 0) {
                    console.log("  VerifierRegistry:  NO transfer initiated");
                    allReady = false;
                } else if (delay > 0) {
                    _logTimelockNotReady("VerifierRegistry", delay);
                    allReady = false;
                } else {
                    console.log("  VerifierRegistry:  READY");
                }
            }
        }

        // 5. DistrictRegistry (own governance implementation, no getGovernanceTransferDelay)
        {
            bool alreadyTransferred = districtRegistry.governance() == newGovernance;
            if (alreadyTransferred) {
                console.log("  DistrictRegistry:  ALREADY transferred");
            } else {
                uint256 execTime = districtRegistry.pendingGovernance(newGovernance);
                if (execTime == 0) {
                    console.log("  DistrictRegistry:  NO transfer initiated");
                    allReady = false;
                } else if (block.timestamp < execTime) {
                    uint256 delay = execTime - block.timestamp;
                    _logTimelockNotReady("DistrictRegistry", delay);
                    allReady = false;
                } else {
                    console.log("  DistrictRegistry:  READY");
                }
            }
        }

        console.log("");

        if (!allReady) {
            revert("Not all governance transfers are ready. See output above for details.");
        }

        console.log("  All timelocks matured. Executing governance transfers...");
        console.log("");

        vm.startBroadcast(deployerKey);

        // Execute on each contract (skip if already transferred)
        if (gate.governance() != newGovernance) {
            gate.executeGovernanceTransfer(newGovernance);
            console.log("  DistrictGate:      transferred");
        }

        if (nullifierRegistry.governance() != newGovernance) {
            nullifierRegistry.executeGovernanceTransfer(newGovernance);
            console.log("  NullifierRegistry: transferred");
        }

        if (campaignRegistry.governance() != newGovernance) {
            campaignRegistry.executeGovernanceTransfer(newGovernance);
            console.log("  CampaignRegistry:  transferred");
        }

        if (verifierRegistry.governance() != newGovernance) {
            verifierRegistry.executeGovernanceTransfer(newGovernance);
            console.log("  VerifierRegistry:  transferred");
        }

        if (districtRegistry.governance() != newGovernance) {
            districtRegistry.executeGovernanceTransfer(newGovernance);
            console.log("  DistrictRegistry:  transferred");
        }

        vm.stopBroadcast();

        // Verify all transfers
        console.log("");
        console.log("  Verifying governance state...");
        require(gate.governance() == newGovernance, "DistrictGate governance not transferred");
        require(nullifierRegistry.governance() == newGovernance, "NullifierRegistry governance not transferred");
        require(campaignRegistry.governance() == newGovernance, "CampaignRegistry governance not transferred");
        require(verifierRegistry.governance() == newGovernance, "VerifierRegistry governance not transferred");
        require(districtRegistry.governance() == newGovernance, "DistrictRegistry governance not transferred");

        console.log("  All 5 contracts now governed by:", newGovernance);
        console.log("");
        console.log("  DONE: Governance transfer complete.");
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    function _logTimelockNotReady(string memory name, uint256 remaining) internal pure {
        uint256 days_ = remaining / 1 days;
        uint256 hours_ = (remaining % 1 days) / 1 hours;
        uint256 minutes_ = (remaining % 1 hours) / 1 minutes;
        console.log(
            string(abi.encodePacked(
                "  ", name, ":  NOT READY - ",
                vm.toString(days_), "d ",
                vm.toString(hours_), "h ",
                vm.toString(minutes_), "m remaining"
            ))
        );
    }
}
