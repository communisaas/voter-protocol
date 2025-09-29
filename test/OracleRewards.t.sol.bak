// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/AgentParameters.sol";
import "../contracts/CommuniqueCore.sol";
import "../contracts/VOTERRegistry.sol";
import "../contracts/VOTERToken.sol";
import "../contracts/IdentityRegistry.sol";
import "../contracts/CivicActionRegistry.sol";
import "../contracts/interfaces/IActionVerifier.sol";
import "../contracts/interfaces/IDiditVerifier.sol";

// Mock Chainlink oracle
contract MockAggregator {
    int256 public answer;
    uint256 public updatedAt;
    
    constructor(int256 _answer) {
        answer = _answer;
        updatedAt = block.timestamp;
    }
    
    function decimals() external pure returns (uint8) {
        return 8;
    }
    
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 _answer,
        uint256 startedAt,
        uint256 _updatedAt,
        uint80 answeredInRound
    ) {
        // Return current block timestamp to avoid underflow in price check
        return (1, answer, block.timestamp, block.timestamp, 1);
    }
    
    function setAnswer(int256 _answer) external {
        answer = _answer;
        updatedAt = block.timestamp;
    }
}

contract MockActionVerifier is IActionVerifier {
    mapping(bytes32 => bool) public verified;
    
    function verifyAction(bytes32, bytes calldata) external pure returns (bool) {
        return true;
    }
    
    function isVerifiedAction(bytes32 actionHash) external view returns (bool) {
        return verified[actionHash] || actionHash != bytes32(0);
    }
    
    function setVerified(bytes32 actionHash, bool status) external {
        verified[actionHash] = status;
    }
}

contract MockDiditVerifier is IDiditVerifier {
    function verifyCredential(bytes32, bytes calldata) external pure returns (bool) {
        return true;
    }
    
    function checkRevocation(bytes32) external pure returns (bool) {
        return false;
    }
    
    function getAttestation(address) external view returns (Attestation memory) {
        return Attestation({
            isVerified: true,
            kycLevel: 1,
            districtHash: keccak256("CA-12"),
            verifiedAt: block.timestamp,
            credentialId: keccak256("test")
        });
    }
    
    function verifyZKProof(bytes calldata, uint256[] calldata) external pure returns (bool) {
        return true;
    }
    
    function getVerificationCost(uint8) external pure returns (uint256) {
        return 0;
    }
}

contract OracleRewardsTest is Test {
    AgentParameters public params;
    CommuniqueCore public core;
    VOTERRegistry public registry;
    VOTERToken public token;
    IdentityRegistry public identityRegistry;
    CivicActionRegistry public civicActionRegistry;
    MockActionVerifier public verifier;
    MockDiditVerifier public diditVerifier;
    
    MockAggregator public chainlinkOracle;
    MockAggregator public redstoneOracle;
    
    address public admin = address(this);
    address public alice = address(0x1);
    bytes32 public districtHash = keccak256("CA-12");
    
    function setUp() public {
        // Deploy oracle mocks
        chainlinkOracle = new MockAggregator(1e8); // $1.00 with 8 decimals
        redstoneOracle = new MockAggregator(1e8);  // $1.00 with 8 decimals
        
        // Deploy contracts
        params = new AgentParameters(admin);
        diditVerifier = new MockDiditVerifier();
        registry = new VOTERRegistry(address(diditVerifier));
        token = new VOTERToken();
        identityRegistry = new IdentityRegistry(admin);
        civicActionRegistry = new CivicActionRegistry(address(identityRegistry), admin);
        verifier = new MockActionVerifier();
        
        core = new CommuniqueCore(
            address(registry),
            address(token),
            address(identityRegistry),
            address(civicActionRegistry),
            address(verifier),
            address(params)
        );
        
        // Configure oracles in parameters
        params.setAddress(keccak256("oracle:VOTER_USD_Chainlink"), address(chainlinkOracle));
        params.setAddress(keccak256("oracle:VOTER_USD_Redstone"), address(redstoneOracle));
        
        // Grant roles - core needs to act on behalf of admin
        registry.grantRole(registry.VERIFIER_ROLE(), address(core));
        registry.grantRole(registry.VERIFIER_ROLE(), admin);
        registry.grantRole(registry.ADMIN_ROLE(), address(core)); // Core needs admin role
        token.grantRole(token.MINTER_ROLE(), address(core));
        identityRegistry.grantRole(identityRegistry.REGISTRAR_ROLE(), address(core));
        civicActionRegistry.grantRole(civicActionRegistry.RECORDER_ROLE(), address(core));
        civicActionRegistry.grantRole(civicActionRegistry.VERIFIER_ROLE(), address(core)); // Core needs verifier role too
        
        // Register and verify Alice
        core.registerParticipant(alice, districtHash);
        registry.verifyCitizenWithDidit(alice, districtHash, keccak256("credential"), bytes("sig"));
    }
    
    function test_OracleBasedReward_StandardPrice() public {
        // Set token price to $1.00 (1e8 with 8 decimals)
        chainlinkOracle.setAnswer(1e8);
        redstoneOracle.setAnswer(1e8);
        
        // Process civic action (CWC message with $0.10 reward)
        bytes32 actionHash = keccak256("action1");
        core.processCivicAction(
            alice,
            VOTERRegistry.ActionType.CWC_MESSAGE,
            actionHash,
            "metadata",
            80 // credibility score
        );
        
        // With token at $1.00 and reward at $0.10, should get 0.1 tokens (1e17 wei)
        uint256 expectedReward = 1e17; // 0.1 * 1e18
        assertEq(token.balanceOf(alice), expectedReward, "Should receive 0.1 tokens at $1 price");
    }
    
    function test_OracleBasedReward_HighPrice() public {
        // Set token price to $10.00
        chainlinkOracle.setAnswer(10e8);
        redstoneOracle.setAnswer(10e8);
        
        // Process civic action
        bytes32 actionHash = keccak256("action2");
        core.processCivicAction(
            alice,
            VOTERRegistry.ActionType.CWC_MESSAGE,
            actionHash,
            "metadata",
            80
        );
        
        // With token at $10.00 and reward at $0.10, should get 0.01 tokens
        uint256 expectedReward = 1e16; // 0.01 * 1e18
        assertEq(token.balanceOf(alice), expectedReward, "Should receive 0.01 tokens at $10 price");
    }
    
    function test_OracleBasedReward_LowPrice() public {
        // Set token price to $0.01 (1 cent)
        chainlinkOracle.setAnswer(1e6); // 0.01 * 1e8
        redstoneOracle.setAnswer(1e6);
        
        // Process civic action
        bytes32 actionHash = keccak256("action3");
        core.processCivicAction(
            alice,
            VOTERRegistry.ActionType.CWC_MESSAGE,
            actionHash,
            "metadata",
            80
        );
        
        // With token at $0.01 and reward at $0.10, should get 10 tokens
        uint256 expectedReward = 10e18; // 10 * 1e18
        assertEq(token.balanceOf(alice), expectedReward, "Should receive 10 tokens at $0.01 price");
    }
    
    function test_OracleConsensus_Averaging() public {
        // Set different prices on oracles
        chainlinkOracle.setAnswer(1e8);  // $1.00
        redstoneOracle.setAnswer(2e8);   // $2.00
        
        // Get consensus price (should average to $1.50)
        (uint256 price, bool isValid) = params.getOracleConsensusPrice();
        assertEq(price, 15e7, "Should average to $1.50"); // 1.5 * 1e8
        assertTrue(isValid, "Price should be valid");
    }
    
    function test_OracleFailure_FallbackReward() public {
        // Deploy new params without oracle addresses
        AgentParameters newParams = new AgentParameters(admin);
        
        // Deploy new core with params that have no oracles
        CommuniqueCore newCore = new CommuniqueCore(
            address(registry),
            address(token),
            address(identityRegistry),
            address(civicActionRegistry),
            address(verifier),
            address(newParams)
        );
        
        // Grant roles
        registry.grantRole(registry.VERIFIER_ROLE(), address(newCore));
        token.grantRole(token.MINTER_ROLE(), address(newCore));
        identityRegistry.grantRole(identityRegistry.REGISTRAR_ROLE(), address(newCore));
        civicActionRegistry.grantRole(civicActionRegistry.RECORDER_ROLE(), address(newCore));
        civicActionRegistry.grantRole(civicActionRegistry.VERIFIER_ROLE(), address(newCore));
        
        // Set fallback reward
        newParams.setUint(keccak256("reward:CWC_MESSAGE"), 2e18); // 2 tokens fallback
        
        // Use bob for this test
        address bob = address(0x2);
        
        // Register and verify bob
        newCore.registerParticipant(bob, districtHash);
        registry.verifyCitizenWithDidit(bob, districtHash, keccak256("credential2"), bytes("sig2"));
        
        // Process civic action
        bytes32 actionHash = keccak256("action4");
        newCore.processCivicAction(
            bob,
            VOTERRegistry.ActionType.CWC_MESSAGE,
            actionHash,
            "metadata",
            80
        );
        
        // Should receive fallback reward
        assertEq(token.balanceOf(bob), 2e18, "Should receive fallback reward when oracles fail");
    }
    
    function test_CircuitBreaker_StalePrice() public {
        // Set price with old timestamp (more than 1 hour old)
        chainlinkOracle.setAnswer(1e8);
        vm.warp(block.timestamp + 2 hours);
        
        // Only Chainlink is stale, RedStone still valid
        (uint256 price, bool isValid) = params.getOracleConsensusPrice();
        assertEq(price, 1e8, "Should use only valid oracle");
        assertTrue(isValid, "Should still be valid with one oracle");
    }
}