// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IVOTERRegistry {
    function updateEpistemicReputation(address citizen, uint256 newScore) external;
    function citizenProfiles(address citizen) external view returns (
        bool verified,
        bytes32 districtHash,
        uint256 totalActions,
        uint256 joinedTimestamp,
        bool isActive,
        bytes32 selfPassportHash,
        uint256 selfVerificationTime,
        uint256 epistemicReputationScore
    );
}