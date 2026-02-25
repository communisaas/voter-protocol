// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

/// @title IAIEvaluationRegistry
/// @notice Interface for the AI evaluation model registry used by DebateMarket
/// @dev DebateMarket calls this to validate signers and retrieve quorum/weight config.
///      The registry manages model signer addresses, provider diversity, and the α weight
///      used in the combined AI + community resolution formula.
interface IAIEvaluationRegistry {
    /// @notice Check whether an address is a registered (active) model signer
    /// @param signer Address to check
    /// @return True if the signer is an active registered model
    function isRegistered(address signer) external view returns (bool);

    /// @notice Get the M-of-N quorum threshold: ceil(2 * modelCount / 3)
    /// @return Minimum number of valid signatures required
    function quorum() external view returns (uint256);

    /// @notice Get the total number of active registered models
    function modelCount() external view returns (uint256);

    /// @notice Get the AI weight α in basis points (0-10000)
    /// @dev Used in: final = α × ai_score + (10000 - α) × community_score
    function aiWeight() external view returns (uint256);

    /// @notice Get the minimum number of distinct providers required
    function minProviders() external view returns (uint256);

    /// @notice Get the current number of distinct active providers
    function providerCount() external view returns (uint256);
}
