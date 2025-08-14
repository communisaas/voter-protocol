// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/ISelfProtocol.sol";

/**
 * @title SelfIntegratedCivicVerifier
 * @dev AVS-like stub for verifying civic actions with Self Protocol identity
 * @notice Combines Self.xyz zero-knowledge identity with congressional message verification
 */
contract SelfIntegratedCivicVerifier {
    ISelfProtocol public immutable selfProtocol;

    enum ActionType {
        CWC_MESSAGE,
        DIRECT_ACTION,
        COMMUNITY_ORGANIZING,
        POLICY_ADVOCACY
    }

    struct CivicAction {
        address citizen;
        bytes32 actionHash;
        ActionType actionType;
        bytes32 districtHash;
        uint256 timestamp;
        bytes metadata;
        bool verified;
    }

    struct CWCVerification {
        string messageId;
        bytes deliveryProof;
        string representativeId;
        uint256 deliveryTimestamp;
    }

    struct VerificationProof {
        bytes32 actionHash;
        address citizen;
        ActionType actionType;
        CWCVerification cwcProof;
        bytes selfIdentityProof;
        uint256 timestamp;
        bytes eigenSignature;
    }

    mapping(bytes32 => CivicAction) public actions;
    mapping(bytes32 => bool) public verifiedActions;
    mapping(address => uint256) public citizenLastAction;
    mapping(bytes32 => CWCVerification) public cwcVerifications;

    uint256 public constant MIN_ACTION_INTERVAL = 1 hours;
    uint256 public constant VERIFICATION_VALIDITY_PERIOD = 365 days;

    // AVS Configuration
    address public operatorRegistry;
    mapping(address => bool) public authorizedOperators;

    event ActionSubmitted(
        bytes32 indexed actionHash,
        address indexed citizen,
        ActionType actionType,
        uint256 timestamp
    );

    event ActionVerified(
        bytes32 indexed actionHash,
        address indexed citizen,
        ActionType actionType,
        uint256 timestamp
    );

    event CWCMessageVerified(
        bytes32 indexed actionHash,
        string messageId,
        string representativeId,
        uint256 deliveryTimestamp
    );

    event VerificationFailed(
        bytes32 indexed actionHash,
        address indexed citizen,
        string reason,
        uint256 timestamp
    );

    modifier onlyAuthorizedOperator() {
        require(authorizedOperators[msg.sender], "Not authorized operator");
        _;
    }

    constructor(address _selfProtocol, address _operatorRegistry) {
        selfProtocol = ISelfProtocol(_selfProtocol);
        operatorRegistry = _operatorRegistry;
        authorizedOperators[msg.sender] = true;
    }

    function submitCivicAction(
        bytes32 actionHash,
        ActionType actionType,
        bytes32 districtHash,
        bytes calldata metadata
    ) external {
        require(actionHash != bytes32(0), "Invalid action hash");
        require(!verifiedActions[actionHash], "Action already exists");
        require(selfProtocol.isVerifiedCitizen(msg.sender), "Citizen not verified");

        // Check minimum action interval to prevent spam
        require(
            block.timestamp >= citizenLastAction[msg.sender] + MIN_ACTION_INTERVAL,
            "Action too frequent"
        );

        // Verify citizen eligibility (age, citizenship)
        require(
            selfProtocol.verifyAgeRequirement(msg.sender, 18),
            "Must be 18+ to participate"
        );
        require(
            selfProtocol.verifyCitizenship(msg.sender, "US"),
            "Must be US citizen"
        );

        actions[actionHash] = CivicAction({
            citizen: msg.sender,
            actionHash: actionHash,
            actionType: actionType,
            districtHash: districtHash,
            timestamp: block.timestamp,
            metadata: metadata,
            verified: false
        });

        citizenLastAction[msg.sender] = block.timestamp;

        emit ActionSubmitted(actionHash, msg.sender, actionType, block.timestamp);
    }

    function verifyCivicAction(
        bytes32 actionHash,
        CWCVerification calldata cwcProof,
        bytes calldata additionalProofs
    ) external onlyAuthorizedOperator {
        require(actions[actionHash].citizen != address(0), "Action does not exist");
        require(!actions[actionHash].verified, "Action already verified");

        address citizen = actions[actionHash].citizen;

        // 1. Verify Self Protocol identity is still valid
        require(_verifySelfIdentityStillValid(citizen), "Self Protocol verification expired");

        // 2. Verify Congressional message delivery (for CWC actions)
        if (actions[actionHash].actionType == ActionType.CWC_MESSAGE) {
            require(_verifyCWCDelivery(cwcProof), "CWC message delivery not verified");
        }

        // 3. Verify action authenticity and metadata
        require(_verifyActionAuthenticity(actionHash, additionalProofs), "Action authenticity verification failed");

        // Mark as verified
        actions[actionHash].verified = true;
        verifiedActions[actionHash] = true;

        // Store CWC verification details
        if (actions[actionHash].actionType == ActionType.CWC_MESSAGE) {
            cwcVerifications[actionHash] = cwcProof;
            emit CWCMessageVerified(actionHash, cwcProof.messageId, cwcProof.representativeId, cwcProof.deliveryTimestamp);
        }

        emit ActionVerified(actionHash, citizen, actions[actionHash].actionType, block.timestamp);
    }

    function generateVerificationProof(bytes32 actionHash) external view returns (bytes memory) {
        require(verifiedActions[actionHash], "Action not verified");

        CivicAction memory action = actions[actionHash];
        CWCVerification memory cwcProof = cwcVerifications[actionHash];

        VerificationProof memory proof = VerificationProof({
            actionHash: actionHash,
            citizen: action.citizen,
            actionType: action.actionType,
            cwcProof: cwcProof,
            selfIdentityProof: _generateSelfProof(action.citizen),
            timestamp: block.timestamp,
            eigenSignature: _generateEigenSignature(actionHash)
        });

        return abi.encode(proof);
    }

    function _verifySelfIdentityStillValid(address citizen) internal view returns (bool) {
        ISelfProtocol.CitizenAttestation memory attestation = selfProtocol.getCitizenAttestation(citizen);
        return attestation.isVerified && block.timestamp <= attestation.expirationTime;
    }

    function _verifyCWCDelivery(CWCVerification calldata cwcProof) internal pure returns (bool) {
        // Placeholder logic for compilation
        return bytes(cwcProof.messageId).length > 0 && bytes(cwcProof.representativeId).length > 0 && cwcProof.deliveryTimestamp > 0;
    }

    function _verifyActionAuthenticity(bytes32 actionHash, bytes calldata additionalProofs) internal pure returns (bool) {
        // Placeholder logic for compilation
        return actionHash != bytes32(0) && additionalProofs.length >= 0;
    }

    function _generateSelfProof(address citizen) internal view returns (bytes memory) {
        string[] memory attributes = new string[](3);
        attributes[0] = "age_over_18";
        attributes[1] = "us_citizen";
        attributes[2] = "passport_verified";
        return selfProtocol.generateSelectiveProof(citizen, attributes);
    }

    function _generateEigenSignature(bytes32 actionHash) internal view returns (bytes memory) {
        return abi.encodePacked(actionHash, block.timestamp, msg.sender);
    }

    function getCivicAction(bytes32 actionHash) external view returns (CivicAction memory) {
        return actions[actionHash];
    }

    function isActionVerified(bytes32 actionHash) external view returns (bool) {
        return verifiedActions[actionHash];
    }

    function addAuthorizedOperator(address operator) external {
        require(msg.sender == operatorRegistry, "Only operator registry");
        authorizedOperators[operator] = true;
    }

    function removeAuthorizedOperator(address operator) external {
        require(msg.sender == operatorRegistry, "Only operator registry");
        authorizedOperators[operator] = false;
    }
}