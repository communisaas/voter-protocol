/**
 * Scoring rubric for the 5 evaluation dimensions.
 * Weights match the on-chain _computeWeightedAIScore packing.
 */

export interface DimensionDefinition {
	name: string;
	key: string;
	weight: number; // basis points out of 10000
	description: string;
}

export const DIMENSIONS: DimensionDefinition[] = [
	{
		name: 'Reasoning Quality',
		key: 'reasoning',
		weight: 3000,
		description:
			'Logical coherence and structure of the argument. Absence of fallacies. Clear causal reasoning. Well-organized progression from premises to conclusions.',
	},
	{
		name: 'Factual Accuracy',
		key: 'accuracy',
		weight: 2500,
		description:
			'Verifiable claims are correct and supported. Statistics, dates, and attributions are accurate. No misrepresentations of opposing positions.',
	},
	{
		name: 'Evidence Strength',
		key: 'evidence',
		weight: 2000,
		description:
			'Quality and relevance of cited sources. Primary sources preferred over secondary. Evidence directly supports the claims made. Sufficient evidence for the scope of claims.',
	},
	{
		name: 'Constructiveness',
		key: 'constructiveness',
		weight: 1500,
		description:
			'Does the argument advance the discourse? Engages with opposing views charitably. Proposes actionable paths forward. Avoids ad hominem or purely destructive critique.',
	},
	{
		name: 'Feasibility',
		key: 'feasibility',
		weight: 1000,
		description:
			'For AMEND arguments: is the proposed change actionable within existing institutional constraints? For SUPPORT/OPPOSE: does the argument account for practical implementation considerations?',
	},
];

/** Dimension weights as a lookup table */
export const DIMENSION_WEIGHTS: Record<string, number> = Object.fromEntries(
	DIMENSIONS.map((d) => [d.key, d.weight]),
);

/** Total weight (should always be 10000) */
export const TOTAL_WEIGHT = DIMENSIONS.reduce((sum, d) => sum + d.weight, 0);
