// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ComplianceVeto
 * @dev Minimal human oversight for FEC compliance - veto-only power
 * @notice The compliance officer cannot control, only prevent illegal actions
 */
contract ComplianceVeto {
    
    enum VetoReason {
        FEC_LIMIT_EXCEEDED,
        RESTRICTED_CLASS_VIOLATION,
        FOREIGN_NATIONAL_PROHIBITION,
        CORPORATE_CONTRIBUTION_PROHIBITED,
        ELECTIONEERING_WINDOW,
        MISSING_DISCLAIMER,
        OTHER_LEGAL_REQUIREMENT
    }
    
    struct PendingDisbursement {
        address recipient;
        uint256 amount;
        string purpose;
        bytes32 proposalHash;
        uint256 createdAt;
        uint256 executesAt;
        bool executed;
        bool vetoed;
        VetoReason vetoReason;
        string vetoExplanation;
    }
    
    // State variables
    address public complianceOfficer;
    address public agentConsensus;
    uint256 public constant VETO_WINDOW = 24 hours;
    uint256 public disbursementCount;
    
    // Compliance metrics (all public for transparency)
    uint256 public totalDisbursementsProcessed;
    uint256 public totalDisbursementsVetoed;
    uint256 public lastVetoTimestamp;
    
    // Disbursement tracking
    mapping(uint256 => PendingDisbursement) public disbursements;
    mapping(bytes32 => uint256) public proposalToDisbursement;
    
    // FEC tracking (simplified - production would be more complex)
    mapping(string => mapping(uint256 => uint256)) public recipientCycleFunding; // recipient => cycle => amount
    uint256 public constant FEC_CYCLE_DURATION = 730 days; // 2 years
    uint256 public constant FEC_PAC_LIMIT = 5_000e18; // $5,000 per candidate per election
    
    // Events
    event DisbursementQueued(
        uint256 indexed disbursementId,
        address recipient,
        uint256 amount,
        string purpose,
        uint256 executesAt
    );
    
    event DisbursementVetoed(
        uint256 indexed disbursementId,
        VetoReason reason,
        string explanation,
        address vetoedBy
    );
    
    event DisbursementExecuted(
        uint256 indexed disbursementId,
        address recipient,
        uint256 amount
    );
    
    event ComplianceOfficerChanged(
        address oldOfficer,
        address newOfficer,
        uint256 timestamp
    );
    
    event ComplianceMetricsUpdated(
        uint256 totalProcessed,
        uint256 totalVetoed,
        uint256 vetoRate
    );
    
    modifier onlyComplianceOfficer() {
        require(msg.sender == complianceOfficer, "Not compliance officer");
        _;
    }
    
    modifier onlyAgentConsensus() {
        require(msg.sender == agentConsensus, "Not agent consensus");
        _;
    }
    
    constructor(address _complianceOfficer, address _agentConsensus) {
        require(_complianceOfficer != address(0), "Invalid officer");
        require(_agentConsensus != address(0), "Invalid consensus");
        
        complianceOfficer = _complianceOfficer;
        agentConsensus = _agentConsensus;
    }
    
    /**
     * @dev Queue a disbursement for compliance review (called by PACTreasury via consensus)
     */
    function queueDisbursement(
        address _recipient,
        uint256 _amount,
        string memory _purpose,
        bytes32 _proposalHash
    ) external onlyAgentConsensus returns (uint256 disbursementId) {
        disbursementId = disbursementCount++;
        
        PendingDisbursement storage disbursement = disbursements[disbursementId];
        disbursement.recipient = _recipient;
        disbursement.amount = _amount;
        disbursement.purpose = _purpose;
        disbursement.proposalHash = _proposalHash;
        disbursement.createdAt = block.timestamp;
        disbursement.executesAt = block.timestamp + VETO_WINDOW;
        disbursement.executed = false;
        disbursement.vetoed = false;
        
        proposalToDisbursement[_proposalHash] = disbursementId;
        
        emit DisbursementQueued(
            disbursementId,
            _recipient,
            _amount,
            _purpose,
            disbursement.executesAt
        );
        
        return disbursementId;
    }
    
    /**
     * @dev Veto a pending disbursement (compliance officer only power)
     * @notice This is the ONLY action the compliance officer can take
     */
    function vetoDisbursement(
        uint256 _disbursementId,
        VetoReason _reason,
        string memory _explanation
    ) external onlyComplianceOfficer {
        PendingDisbursement storage disbursement = disbursements[_disbursementId];
        
        require(disbursement.createdAt > 0, "Disbursement not found");
        require(!disbursement.executed, "Already executed");
        require(!disbursement.vetoed, "Already vetoed");
        require(
            block.timestamp < disbursement.executesAt,
            "Veto window expired"
        );
        
        disbursement.vetoed = true;
        disbursement.vetoReason = _reason;
        disbursement.vetoExplanation = _explanation;
        
        totalDisbursementsVetoed++;
        lastVetoTimestamp = block.timestamp;
        
        emit DisbursementVetoed(
            _disbursementId,
            _reason,
            _explanation,
            complianceOfficer
        );
        
        // Update metrics
        updateComplianceMetrics();
    }
    
    /**
     * @dev Check if disbursement can be executed (called by PACTreasury)
     */
    function canExecute(uint256 _disbursementId) external view returns (bool) {
        PendingDisbursement storage disbursement = disbursements[_disbursementId];
        
        return (
            disbursement.createdAt > 0 &&
            !disbursement.executed &&
            !disbursement.vetoed &&
            block.timestamp >= disbursement.executesAt
        );
    }
    
    /**
     * @dev Mark disbursement as executed (called by PACTreasury)
     */
    function markExecuted(uint256 _disbursementId) external onlyAgentConsensus {
        PendingDisbursement storage disbursement = disbursements[_disbursementId];
        
        require(disbursement.createdAt > 0, "Disbursement not found");
        require(!disbursement.executed, "Already executed");
        require(!disbursement.vetoed, "Was vetoed");
        require(
            block.timestamp >= disbursement.executesAt,
            "Still in veto window"
        );
        
        disbursement.executed = true;
        totalDisbursementsProcessed++;
        
        // Track FEC limits (simplified)
        uint256 currentCycle = block.timestamp / FEC_CYCLE_DURATION;
        recipientCycleFunding[disbursement.purpose][currentCycle] += disbursement.amount;
        
        emit DisbursementExecuted(
            _disbursementId,
            disbursement.recipient,
            disbursement.amount
        );
        
        updateComplianceMetrics();
    }
    
    /**
     * @dev Get current FEC cycle funding for a recipient
     */
    function getCurrentCycleFunding(string memory _recipient) 
        external 
        view 
        returns (uint256) 
    {
        uint256 currentCycle = block.timestamp / FEC_CYCLE_DURATION;
        return recipientCycleFunding[_recipient][currentCycle];
    }
    
    /**
     * @dev Check if disbursement would exceed FEC limits
     */
    function wouldExceedFECLimit(
        string memory _recipient,
        uint256 _amount
    ) external view returns (bool) {
        uint256 currentCycle = block.timestamp / FEC_CYCLE_DURATION;
        uint256 currentFunding = recipientCycleFunding[_recipient][currentCycle];
        return (currentFunding + _amount) > FEC_PAC_LIMIT;
    }
    
    /**
     * @dev Update compliance metrics
     */
    function updateComplianceMetrics() internal {
        uint256 vetoRate = 0;
        if (totalDisbursementsProcessed > 0) {
            vetoRate = (totalDisbursementsVetoed * 100) / 
                       (totalDisbursementsProcessed + totalDisbursementsVetoed);
        }
        
        emit ComplianceMetricsUpdated(
            totalDisbursementsProcessed,
            totalDisbursementsVetoed,
            vetoRate
        );
    }
    
    /**
     * @dev Change compliance officer (requires both old and new officer signatures)
     * @notice This ensures smooth transition and prevents abandonment
     */
    function changeComplianceOfficer(
        address _newOfficer,
        bytes memory _oldOfficerSignature,
        bytes memory _newOfficerSignature
    ) external {
        require(_newOfficer != address(0), "Invalid new officer");
        
        // Verify both signatures (simplified - production would use proper ECDSA)
        require(
            _oldOfficerSignature.length > 0 && _newOfficerSignature.length > 0,
            "Missing signatures"
        );
        
        address oldOfficer = complianceOfficer;
        complianceOfficer = _newOfficer;
        
        emit ComplianceOfficerChanged(oldOfficer, _newOfficer, block.timestamp);
    }
    
    /**
     * @dev Get veto statistics for transparency
     */
    function getVetoStatistics() 
        external 
        view 
        returns (
            uint256 processed,
            uint256 vetoed,
            uint256 vetoRate,
            uint256 lastVeto
        ) 
    {
        processed = totalDisbursementsProcessed;
        vetoed = totalDisbursementsVetoed;
        if (processed + vetoed > 0) {
            vetoRate = (vetoed * 100) / (processed + vetoed);
        }
        lastVeto = lastVetoTimestamp;
    }
    
    /**
     * @dev Get detailed disbursement info
     */
    function getDisbursementDetails(uint256 _disbursementId)
        external
        view
        returns (
            address recipient,
            uint256 amount,
            string memory purpose,
            uint256 executesAt,
            bool executed,
            bool vetoed,
            string memory vetoExplanation
        )
    {
        PendingDisbursement storage d = disbursements[_disbursementId];
        return (
            d.recipient,
            d.amount,
            d.purpose,
            d.executesAt,
            d.executed,
            d.vetoed,
            d.vetoExplanation
        );
    }
    
    /**
     * @dev Emergency contact info (publicly readable)
     */
    string public constant COMPLIANCE_CONTACT = "compliance@voterprotocol.org";
    string public constant LEGAL_COUNSEL = "FEC Counsel: [Law Firm Name]";
    
    /**
     * @dev No other functions - compliance officer has no other powers
     * Cannot: initiate transactions, change parameters, access funds,
     *         modify contracts, grant roles, or take any positive action
     * Can only: veto disbursements within 24-hour window
     */
}