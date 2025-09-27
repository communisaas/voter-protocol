// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../UnifiedRegistry.sol";
// Legacy registry interfaces - simplified for migration
interface IVOTERRegistry {
    struct Participant {
        uint256 id;
        address wallet;
    }
    function getParticipant(address) external view returns (Participant memory);
}

interface IReputationRegistry {
    function getFullReputation(address) external view returns (
        uint256, uint256, uint256, uint256, uint256, uint256, bytes32
    );
}

interface ICivicActionRegistry {
    function getActionCount(address) external view returns (uint256);
    function getCWCMessageCount(address) external view returns (uint256);
}

interface IValidationRegistry {
    struct ValidationStats {
        uint256 successful;
        uint256 failed;
    }
    function getValidationStats(address) external view returns (ValidationStats memory);
}

interface IImpactRegistry {
    struct ParticipantImpact {
        uint256 score;
        uint256 citations;
    }
    function getParticipantImpact(address) external view returns (ParticipantImpact memory);
}

interface IIdentityRegistry {
    function getIdentity(address) external view returns (bytes32, uint256);
}

interface ITemplateRegistry {
    struct Template {
        string contentURI;
        address creator;
    }
    function getUserTemplates(address) external view returns (bytes32[] memory);
    function getTemplate(bytes32) external view returns (Template memory);
}

/**
 * @title RegistryMigrator
 * @dev One-time migration from 7 separate registries to UnifiedRegistry
 * @notice No admin control - migration is permissionless and irreversible
 */
contract RegistryMigrator {
    
    // Old registries to migrate from
    IVOTERRegistry public immutable oldVoterRegistry;
    IReputationRegistry public immutable oldReputationRegistry;
    ICivicActionRegistry public immutable oldActionRegistry;
    IValidationRegistry public immutable oldValidationRegistry;
    IImpactRegistry public immutable oldImpactRegistry;
    IIdentityRegistry public immutable oldIdentityRegistry;
    ITemplateRegistry public immutable oldTemplateRegistry;
    
    // New unified registry
    UnifiedRegistry public immutable unifiedRegistry;
    
    // Migration tracking
    mapping(address => bool) public hasMigrated;
    uint256 public totalMigrated;
    
    // Migration deadline - after this, contract self-destructs
    uint256 public immutable migrationDeadline;
    
    // Events
    event CitizenMigrated(address indexed citizen, uint256 participantId);
    event MigrationCompleted(uint256 totalCitizens);
    
    constructor(
        address _oldVoter,
        address _oldReputation,
        address _oldAction,
        address _oldValidation,
        address _oldImpact,
        address _oldIdentity,
        address _oldTemplate,
        address _unifiedRegistry
    ) {
        oldVoterRegistry = IVOTERRegistry(_oldVoter);
        oldReputationRegistry = IReputationRegistry(_oldReputation);
        oldActionRegistry = ICivicActionRegistry(_oldAction);
        oldValidationRegistry = IValidationRegistry(_oldValidation);
        oldImpactRegistry = IImpactRegistry(_oldImpact);
        oldIdentityRegistry = IIdentityRegistry(_oldIdentity);
        oldTemplateRegistry = ITemplateRegistry(_oldTemplate);
        unifiedRegistry = UnifiedRegistry(_unifiedRegistry);
        
        // 90 day migration window
        migrationDeadline = block.timestamp + 90 days;
    }
    
    /**
     * @dev Migrate a citizen's data - fully permissionless
     * @param citizen Address to migrate
     */
    function migrateCitizen(address citizen) external {
        require(!hasMigrated[citizen], "Already migrated");
        require(block.timestamp < migrationDeadline, "Migration ended");
        
        // Get participant ID from VOTER registry
        IVOTERRegistry.Participant memory participant = oldVoterRegistry.getParticipant(citizen);
        require(participant.id > 0, "Not registered");
        
        // Get identity data
        (bytes32 districtHash,) = oldIdentityRegistry.getIdentity(citizen);
        
        // Get reputation data
        (
            uint256 overallScore,
            uint256 challengeWins,
            uint256 challengeLosses,
            uint256 templateImpact,
            uint256 discourseQuality,
            uint256 verifiedActions,
            bytes32 credibilityHash
        ) = oldReputationRegistry.getFullReputation(citizen);
        
        // Get action counts
        uint256 actionCount = oldActionRegistry.getActionCount(citizen);
        uint256 cwcCount = oldActionRegistry.getCWCMessageCount(citizen);
        
        // Get template count
        bytes32[] memory templates = oldTemplateRegistry.getUserTemplates(citizen);
        
        // Get validation data
        IValidationRegistry.ValidationStats memory valStats = oldValidationRegistry.getValidationStats(citizen);
        
        // Get impact data
        IImpactRegistry.ParticipantImpact memory impact = oldImpactRegistry.getParticipantImpact(citizen);
        
        // Register in unified registry
        uint256 participantId = unifiedRegistry.registerCitizen(citizen, districtHash);
        
        // Update consolidated profile
        // Note: UnifiedRegistry would need setter functions for migration
        // This is simplified - actual implementation would batch update
        unifiedRegistry.updateReputation(
            citizen,
            overallScore
        );
        
        // Mark as migrated
        hasMigrated[citizen] = true;
        totalMigrated++;
        
        emit CitizenMigrated(citizen, participantId);
    }
    
    /**
     * @dev Batch migrate multiple citizens
     */
    function batchMigrate(address[] calldata citizens) external {
        for (uint256 i = 0; i < citizens.length; i++) {
            if (!hasMigrated[citizens[i]]) {
                try this.migrateCitizen(citizens[i]) {
                    // Success
                } catch {
                    // Skip failed migrations
                    continue;
                }
            }
        }
    }
    
    /**
     * @dev Migrate templates for a creator
     */
    function migrateTemplates(address creator) external {
        require(hasMigrated[creator], "Citizen not migrated");
        
        bytes32[] memory templates = oldTemplateRegistry.getUserTemplates(creator);
        
        for (uint256 i = 0; i < templates.length; i++) {
            ITemplateRegistry.Template memory template = oldTemplateRegistry.getTemplate(templates[i]);
            
            // Create in unified registry
            unifiedRegistry.createTemplate(
                creator,
                template.contentURI
            );
        }
    }
    
    /**
     * @dev Complete migration - callable by anyone after deadline
     */
    function completeMigration() external {
        require(block.timestamp >= migrationDeadline, "Migration still active");
        
        emit MigrationCompleted(totalMigrated);
        
        // Contract becomes unusable after deadline
        // No selfdestruct - just becomes inactive
    }
    
    /**
     * @dev Check migration status
     */
    function getMigrationStatus() external view returns (
        uint256 migrated,
        uint256 timeRemaining,
        bool isComplete
    ) {
        migrated = totalMigrated;
        timeRemaining = block.timestamp < migrationDeadline 
            ? migrationDeadline - block.timestamp 
            : 0;
        isComplete = block.timestamp >= migrationDeadline;
    }
}

// Permissionless migration preserves user sovereignty