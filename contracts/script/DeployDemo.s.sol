// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Script.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";
import "../src/DistrictGate.sol";
import "../src/DebateMarket.sol";
import "../src/IDebateWeightVerifier.sol";
import "../src/IPositionNoteVerifier.sol";
import "../src/IAIEvaluationRegistry.sol";
import {MockHonkVerifier, MockDebateWeightVerifier, MockPositionNoteVerifier, MockAIEvaluationRegistry, MockERC20} from "./DeploySepoliaV6.s.sol";

/// @title Deploy Demo Stack — Bittensor Subnet Hackathon Demo
/// @notice Deploys a fresh DebateMarket with patched MIN_DURATION + ARGUMENT_COOLDOWN,
///         seeds a debate with 3 arguments using proper EIP-712 DistrictGate signatures,
///         ready for subnet AI evaluation after the 2-minute deadline.
///
/// The DemoSeeder contract solves the forge simulation/broadcast mismatch:
/// debateId = keccak256(..., block.timestamp, ...) differs between simulation and
/// actual on-chain execution. By wrapping proposeDebate + submitArgument in a single
/// contract call, the real debateId flows correctly within one transaction.
///
/// USAGE:
///   cd voter-protocol/contracts
///   ./script/deploy_demo.sh    # handles constant swap + deploy + seed + revert
contract DeployDemo is Script {
    uint256 constant SCROLL_SEPOLIA_CHAIN_ID = 534351;
    uint256 constant BN254_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // Must match DistrictGate.SUBMIT_THREE_TREE_PROOF_TYPEHASH
    bytes32 constant SUBMIT_THREE_TREE_PROOF_TYPEHASH = keccak256(
        "SubmitThreeTreeProof(bytes32 proofHash,bytes32 publicInputsHash,uint8 verifierDepth,uint256 nonce,uint256 deadline)"
    );

    function run() external {
        require(block.chainid == SCROLL_SEPOLIA_CHAIN_ID, "Must deploy to Scroll Sepolia");

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        console.log("=== DEMO STACK DEPLOYMENT ===");
        console.log("Deployer:", deployer);

        vm.startBroadcast(pk);

        // --- Mocks ---
        MockHonkVerifier mockHonk = new MockHonkVerifier();
        MockDebateWeightVerifier dwVerifier = new MockDebateWeightVerifier();
        MockPositionNoteVerifier pnVerifier = new MockPositionNoteVerifier();
        MockAIEvaluationRegistry aiRegistry = new MockAIEvaluationRegistry();
        MockERC20 tUSDC = new MockERC20("Demo USDC", "dUSDC", 6);

        // --- Registries (10-minute timelocks — V11 minimum) ---
        uint256 t = 10 minutes; // MIN_GOVERNANCE_TIMELOCK
        DistrictRegistry districtRegistry = new DistrictRegistry(deployer, t);
        NullifierRegistry nullifierRegistry = new NullifierRegistry(deployer, t, t);
        VerifierRegistry verifierRegistry = new VerifierRegistry(deployer, t, t);
        DistrictGate gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            deployer, t, t, t, t
        );

        // --- DebateMarket (with patched MIN_DURATION + ARGUMENT_COOLDOWN) ---
        DebateMarket debateMarket = new DebateMarket(
            address(gate),
            address(dwVerifier),
            address(pnVerifier),
            address(aiRegistry),
            deployer,
            address(tUSDC),
            200 // 2% fee
        );

        // --- Genesis config ---
        verifierRegistry.registerVerifier(20, address(mockHonk));
        verifierRegistry.registerThreeTreeVerifier(20, address(mockHonk));
        verifierRegistry.sealGenesis();

        nullifierRegistry.authorizeCallerGenesis(address(gate));
        nullifierRegistry.sealGenesis();

        gate.setRegistriesGenesis(
            address(new UserRootRegistryStub()),
            address(new CellMapRegistryStub())
        );
        gate.setEngagementRegistryGenesis(address(new EngagementRootRegistryStub()));
        gate.authorizeDeriverGenesis(address(debateMarket));

        bytes32 baseDomain = keccak256("commons-demo-v1");
        gate.registerActionDomainGenesis(baseDomain);
        gate.sealGenesis();

        // --- Deploy DemoSeeder + fund it with tUSDC ---
        DemoSeeder seeder = new DemoSeeder();
        tUSDC.mint(address(seeder), 100_000e6); // 100k dUSDC

        // --- Pre-compute EIP-712 signatures ---
        bytes32 propositionHash = keccak256(
            "San Francisco must enact a graduated vacancy tax on residential units left unoccupied for more than 180 days"
        );

        // Derived action domain — must match what proposeDebate registers with the gate
        bytes32 debateActionDomain = bytes32(
            uint256(keccak256(abi.encodePacked(baseDomain, "debate", propositionHash)))
                % BN254_MODULUS
        );

        // EIP-712 domain separator for the gate
        bytes32 gateDomainSep = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("DistrictGate")),
                keccak256(bytes("1")),
                block.chainid,
                address(gate)
            )
        );

        bytes memory dummyProof = hex"00";
        uint256 argDeadline = block.timestamp + 3600;

        // Build all 3 argument submissions with pre-computed EIP-712 sigs.
        // Signatures depend on (proofHash, publicInputsHash, verifierDepth, nonce, deadline)
        // — none of which depend on debateId, so they can be computed here.
        DemoSeeder.ArgData[3] memory args;

        args[0] = _buildArg(
            pk, gateDomainSep, debateActionDomain, dummyProof, argDeadline,
            DebateMarket.Stance.SUPPORT,
            keccak256("3D-printed homes can be built for 40% less than traditional construction"),
            bytes32(0),
            1, // nullifier
            0  // gate nonce (fresh gate, deployer starts at 0)
        );

        args[1] = _buildArg(
            pk, gateDomainSep, debateActionDomain, dummyProof, argDeadline,
            DebateMarket.Stance.OPPOSE,
            keccak256("Vacancy taxes drive landlords to convert units to short-term rentals"),
            bytes32(0),
            2, // nullifier
            1  // gate nonce
        );

        args[2] = _buildArg(
            pk, gateDomainSep, debateActionDomain, dummyProof, argDeadline,
            DebateMarket.Stance.AMEND,
            keccak256("Tax should exempt units under active renovation with verified permits"),
            keccak256("Add section 4b: renovation exemption with 6-month cap"),
            3, // nullifier
            2  // gate nonce
        );

        // --- Atomic seed: proposeDebate + 3x submitArgument in ONE transaction ---
        // This solves the forge simulation/broadcast debateId mismatch.
        seeder.seed(
            debateMarket,
            tUSDC,
            propositionHash,
            120,    // 2 minutes duration
            100,    // jurisdictionSizeHint
            baseDomain,
            1e6,    // 1 dUSDC bond
            args
        );

        vm.stopBroadcast();

        // --- Output ---
        // Note: debateId logged here is from simulation (may differ from on-chain).
        // Use `cast call <seeder> "lastDebateId()(bytes32)"` for the real value.
        console.log("");
        console.log("=== DEMO STACK DEPLOYED ===");
        console.log("DebateMarket:", address(debateMarket));
        console.log("StakingToken:", address(tUSDC));
        console.log("AIRegistry:  ", address(aiRegistry));
        console.log("DemoSeeder:  ", address(seeder));
        console.log("Arguments:    3 (SUPPORT, OPPOSE, AMEND)");
        console.log("Deadline:     ~2 minutes from now");
        console.log("");
        console.log("Read real debateId after deploy:");
        console.log("  cast call <DemoSeeder> 'lastDebateId()(bytes32)' --rpc-url https://sepolia-rpc.scroll.io");
    }

    /// @dev Build an ArgData struct with pre-computed EIP-712 signature
    function _buildArg(
        uint256 pk,
        bytes32 gateDomainSep,
        bytes32 debateActionDomain,
        bytes memory proof,
        uint256 deadline,
        DebateMarket.Stance stance,
        bytes32 bodyHash,
        bytes32 amendmentHash,
        uint256 nullifier,
        uint256 nonce
    ) internal returns (DemoSeeder.ArgData memory arg) {
        address signer = vm.addr(pk);

        // Build public inputs with correct DistrictGate indices:
        // [0]=userRoot  [1]=cellMapRoot  [2..25]=districts
        // [26]=nullifier  [27]=actionDomain  [28]=authorityLevel
        // [29]=engagementRoot  [30]=engagementTier
        uint256[31] memory pi;
        pi[0]  = uint256(keccak256("userRoot"));          // stub: always valid
        pi[1]  = uint256(keccak256("cellMapRoot"));       // stub: always valid
        pi[26] = nullifier;                                // unique per argument
        pi[27] = uint256(debateActionDomain);              // must match debate
        pi[28] = 3;                                        // authority level (1-5)
        pi[29] = uint256(keccak256("engagementRoot"));    // stub: always valid
        pi[30] = 2;                                        // engagement tier (0-4)

        // EIP-712 signature for DistrictGate.verifyThreeTreeProof
        bytes32 proofHash = keccak256(proof);
        bytes32 publicInputsHash = keccak256(abi.encodePacked(pi));

        bytes32 structHash = keccak256(
            abi.encode(
                SUBMIT_THREE_TREE_PROOF_TYPEHASH,
                proofHash,
                publicInputsHash,
                uint8(20), // verifierDepth
                nonce,
                deadline
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", gateDomainSep, structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        arg = DemoSeeder.ArgData({
            stance: stance,
            bodyHash: bodyHash,
            amendmentHash: amendmentHash,
            stakeAmount: 1e6,
            signer: signer,
            proof: proof,
            publicInputs: pi,
            verifierDepth: 20,
            deadline: deadline,
            signature: abi.encodePacked(r, s, v),
            beneficiary: signer
        });
    }
}

/// @title DemoSeeder — Atomically proposes a debate + submits arguments
/// @notice Solves the forge simulation/broadcast debateId mismatch by keeping
///         proposeDebate + submitArgument in a single on-chain transaction.
///         The real debateId (which depends on block.timestamp) flows correctly
///         within the atomic call. Read lastDebateId() after deployment.
contract DemoSeeder {
    struct ArgData {
        DebateMarket.Stance stance;
        bytes32 bodyHash;
        bytes32 amendmentHash;
        uint256 stakeAmount;
        address signer;
        bytes proof;
        uint256[31] publicInputs;
        uint8 verifierDepth;
        uint256 deadline;
        bytes signature;
        address beneficiary;
    }

    /// @notice The real debateId from the last seed() call — read this after deployment
    bytes32 public lastDebateId;

    event DebateSeeded(bytes32 indexed debateId, uint256 argumentCount);

    function seed(
        DebateMarket market,
        MockERC20 token,
        bytes32 propositionHash,
        uint256 duration,
        uint256 jurisdictionSizeHint,
        bytes32 baseDomain,
        uint256 bondAmount,
        ArgData[3] memory args
    ) external returns (bytes32 debateId) {
        // Approve market for all token operations (bond + 3 stakes)
        token.approve(address(market), type(uint256).max);

        // Propose debate — debateId uses block.timestamp, correct within this tx
        debateId = market.proposeDebate(
            propositionHash, duration, jurisdictionSizeHint, baseDomain, bondAmount
        );

        // Store for external reading after deployment
        lastDebateId = debateId;

        // Submit all 3 arguments using the real on-chain debateId
        for (uint256 i = 0; i < 3; i++) {
            market.submitArgument(
                debateId,
                args[i].stance,
                args[i].bodyHash,
                args[i].amendmentHash,
                args[i].stakeAmount,
                args[i].signer,
                args[i].proof,
                args[i].publicInputs,
                args[i].verifierDepth,
                args[i].deadline,
                args[i].signature,
                args[i].beneficiary
            );
        }

        emit DebateSeeded(debateId, 3);
    }
}

/// @notice Stub registries — always-valid for demo. DistrictGate calls these
///         during three-tree proof verification. All return valid/true.
contract UserRootRegistryStub {
    function isValidUserRoot(bytes32) external pure returns (bool) { return true; }
    function getCountryAndDepth(bytes32) external pure returns (bytes3 country, uint8 depth) {
        return (bytes3("US\x00"), 20);
    }
    function getUserRootMetadata(bytes32) external pure returns (bytes3, uint8, bool, uint64) {
        return (bytes3("US\x00"), 20, true, type(uint64).max);
    }
}

contract CellMapRegistryStub {
    function isValidCellMapRoot(bytes32) external pure returns (bool) { return true; }
    function getCountryAndDepth(bytes32) external pure returns (bytes3 country, uint8 depth) {
        return (bytes3("US\x00"), 20);
    }
}

contract EngagementRootRegistryStub {
    function isValidEngagementRoot(bytes32) external pure returns (bool) { return true; }
    function getDepth(bytes32) external pure returns (uint8) { return 20; }
}
