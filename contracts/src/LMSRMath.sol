// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { SD59x18, sd, ZERO as SD_ZERO } from "prb-math/SD59x18.sol";

/// @title LMSRMath
/// @notice Logarithmic Market Scoring Rule (LMSR) math library
/// @dev Deployed separately from DebateMarket to reduce bytecode (EIP-170).
///      Public functions use DELEGATECALL — they execute in the caller's context.
library LMSRMath {
	/// @notice Saturation cap for q_i / b to prevent exp() overflow
	/// @dev PRBMath exp() reverts at ~133.08e18. We cap at 100e18 for safety margin.
	int256 public constant LMSR_SATURATION_CAP = 100e18;

	/// @notice Cap q_i / b ratio to prevent PRBMath exp() overflow
	/// @dev exp() reverts at ~133.08e18. We cap at ±100e18 for 33% safety margin.
	function capRatio(SD59x18 ratio) public pure returns (SD59x18) {
		if (ratio.unwrap() > LMSR_SATURATION_CAP) {
			return sd(LMSR_SATURATION_CAP);
		}
		if (ratio.unwrap() < -LMSR_SATURATION_CAP) {
			return sd(-LMSR_SATURATION_CAP);
		}
		return ratio;
	}

	/// @notice Babylonian method integer square root
	/// @param x Input value
	/// @return y Floor of sqrt(x)
	function sqrt(uint256 x) public pure returns (uint256 y) {
		if (x == 0) return 0;
		uint256 z = (x + 1) / 2;
		y = x;
		while (z < y) {
			y = z;
			z = (x / z + z) / 2;
		}
	}

	/// @notice Engagement tier to score multiplier (2^tier)
	/// @dev Tier 0 ("no engagement history") returns 0, which is used as a sentinel
	///      to reject participation via InvalidEngagementTier. Only tiers 1-4 are
	///      eligible for debate staking.
	function tierMultiplier(uint8 tier) public pure returns (uint256) {
		if (tier == 1) return 2;
		if (tier == 2) return 4;
		if (tier == 3) return 8;
		if (tier == 4) return 16;
		return 0;
	}

	/// @notice Compute LMSR price for a single argument
	/// @param quantities Array of q_i values for all arguments
	/// @param liquidity The liquidity parameter b
	/// @param targetIndex Index of the argument to price
	/// @return price Price as SD59x18 (between 0 and 1e18)
	function computePrice(
		SD59x18[] memory quantities,
		SD59x18 liquidity,
		uint256 targetIndex
	) public pure returns (SD59x18 price) {
		uint256 count = quantities.length;
		if (count == 0) return SD_ZERO;
		if (targetIndex >= count) return SD_ZERO;
		if (liquidity == SD_ZERO) return SD_ZERO;

		SD59x18 expSum = SD_ZERO;
		SD59x18 expI = SD_ZERO;

		for (uint256 j = 0; j < count; j++) {
			SD59x18 ratio = quantities[j] / liquidity;
			SD59x18 capped = capRatio(ratio);
			SD59x18 expJ = capped.exp();
			expSum = expSum + expJ;
			if (j == targetIndex) {
				expI = expJ;
			}
		}

		if (expSum == SD_ZERO) return SD_ZERO;
		price = expI / expSum;
	}

	/// @notice Compute LMSR prices for all arguments
	/// @param quantities Array of q_i values for all arguments
	/// @param liquidity The liquidity parameter b
	/// @return prices Array of prices (SD59x18, each between 0 and 1e18, sum to ~1e18)
	function computePrices(
		SD59x18[] memory quantities,
		SD59x18 liquidity
	) public pure returns (SD59x18[] memory prices) {
		uint256 count = quantities.length;
		prices = new SD59x18[](count);
		if (count == 0) return prices;
		if (liquidity == SD_ZERO) return prices;

		// First pass: compute exp(q_i / b) for each argument and the sum
		SD59x18[] memory exps = new SD59x18[](count);
		SD59x18 expSum = SD_ZERO;

		for (uint256 i = 0; i < count; i++) {
			SD59x18 ratio = quantities[i] / liquidity;
			SD59x18 capped = capRatio(ratio);
			exps[i] = capped.exp();
			expSum = expSum + exps[i];
		}

		// Second pass: normalize
		if (expSum != SD_ZERO) {
			for (uint256 i = 0; i < count; i++) {
				prices[i] = exps[i] / expSum;
			}
		}
	}

	/// @notice Compute dimension-weighted AI score from packed representation
	/// @param packed Packed scores: [reasoning:16][accuracy:16][evidence:16][constructiveness:16][feasibility:16]
	/// @return Weighted score in range 0-10000 (basis points)
	function computeWeightedAIScore(uint256 packed) public pure returns (uint256) {
		uint256 reasoning        = (packed >> 64) & 0xFFFF; // weight: 3000
		uint256 accuracy         = (packed >> 48) & 0xFFFF; // weight: 2500
		uint256 evidence         = (packed >> 32) & 0xFFFF; // weight: 2000
		uint256 constructiveness = (packed >> 16) & 0xFFFF; // weight: 1500
		uint256 feasibility      = packed & 0xFFFF;          // weight: 1000
		if (reasoning > 10000 || accuracy > 10000 ||
		    evidence > 10000 || constructiveness > 10000 ||
		    feasibility > 10000) revert ScoreExceedsBasisPoints();
		return (reasoning * 3000 + accuracy * 2500 + evidence * 2000
		      + constructiveness * 1500 + feasibility * 1000) / 10000;
	}

	/// @notice Compute blended final score: alpha * ai + (1 - alpha) * normalize(community)
	/// @param aiScore AI weighted score (0-10000)
	/// @param communityScore Raw community weighted score
	/// @param maxCommunityScore Maximum community score across all arguments (for normalization)
	/// @param alpha AI weight in basis points (0-10000)
	/// @return Final blended score (0-10000)
	function computeFinalScore(
		uint256 aiScore,
		uint256 communityScore,
		uint256 maxCommunityScore,
		uint256 alpha
	) public pure returns (uint256) {
		uint256 normalizedCommunity = maxCommunityScore > 0
			? (communityScore * 10000) / maxCommunityScore
			: 0;
		return (alpha * aiScore + (10000 - alpha) * normalizedCommunity) / 10000;
	}

	error ScoreExceedsBasisPoints();
}
