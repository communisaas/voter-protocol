/**
 * DistrictGate Event Handlers (Wave 15c)
 *
 * Indexes all verification events and governance operations from DistrictGate.
 */

import { BigInt, Bytes } from '@graphprotocol/graph-ts';
import {
	ActionVerified,
	TwoTreeProofVerified,
	ActionDomainProposed,
	ActionDomainActivated,
	ActionDomainRevoked,
	ActionDomainMinAuthoritySet,
	MinAuthorityIncreaseProposed,
	CampaignRegistryChangeProposed,
	TwoTreeRegistriesProposed
} from '../../generated/DistrictGate/DistrictGate';
import { Action, ActionDomain, GovernanceEvent } from '../../generated/schema';

export function handleActionVerified(event: ActionVerified): void {
	// Wave 15R fix (C-01): Use txHash-logIndex to prevent ID collision
	const id = event.transaction.hash.toHexString() + '-' + event.logIndex.toString();
	const action = new Action(id);

	action.user = event.params.user;
	action.submitter = event.params.submitter;
	action.proofType = 'single_tree';
	action.primaryRoot = event.params.districtRoot;
	action.cellMapRoot = null;
	action.country = event.params.country;
	action.depth = event.params.depth;
	action.nullifier = event.params.nullifier;
	// Wave 15R fix (C-02): Safe extraction — authority level is a uint8 packed in bytes32
	action.authorityLevel = event.params.authorityLevel[31];
	action.actionDomain = event.params.actionDomain;
	action.districtId = event.params.districtId;
	action.timestamp = event.block.timestamp;
	action.blockNumber = event.block.number;
	action.txHash = event.transaction.hash;

	action.save();
}

export function handleTwoTreeProofVerified(event: TwoTreeProofVerified): void {
	// Wave 15R fix (C-01): Use txHash-logIndex to prevent ID collision
	const id = event.transaction.hash.toHexString() + '-' + event.logIndex.toString();
	const action = new Action(id);

	action.user = event.params.signer;
	action.submitter = event.params.submitter;
	action.proofType = 'two_tree';
	action.primaryRoot = event.params.userRoot;
	action.cellMapRoot = event.params.cellMapRoot;
	action.country = null;
	action.depth = event.params.verifierDepth;
	action.nullifier = event.params.nullifier;
	// Wave 15R fix (C-02): Safe extraction — authority level is a uint8 packed in bytes32
	action.authorityLevel = event.params.authorityLevel[31];
	action.actionDomain = event.params.actionDomain;
	action.districtId = null;
	action.timestamp = event.block.timestamp;
	action.blockNumber = event.block.number;
	action.txHash = event.transaction.hash;

	action.save();
}

export function handleActionDomainProposed(event: ActionDomainProposed): void {
	const id = event.params.actionDomain.toHexString();
	let domain = ActionDomain.load(id);
	if (!domain) {
		domain = new ActionDomain(id);
		domain.isActive = false;
		domain.minAuthority = 0;
		domain.pendingMinAuthority = 0;
		domain.pendingExecuteTime = BigInt.fromI32(0);
	}
	domain.proposedAt = event.block.timestamp;
	domain.save();

	// Governance event
	const govId =
		event.transaction.hash.toHexString() + '-' + event.logIndex.toString();
	const gov = new GovernanceEvent(govId);
	gov.eventType = 'propose';
	gov.target = 'action_domain';
	gov.targetId = event.params.actionDomain;
	gov.executeTime = event.params.executeTime;
	gov.timestamp = event.block.timestamp;
	gov.save();
}

export function handleActionDomainActivated(event: ActionDomainActivated): void {
	const id = event.params.actionDomain.toHexString();
	let domain = ActionDomain.load(id);
	if (!domain) {
		domain = new ActionDomain(id);
		domain.minAuthority = 0;
		domain.pendingMinAuthority = 0;
		domain.pendingExecuteTime = BigInt.fromI32(0);
	}
	domain.isActive = true;
	domain.activatedAt = event.block.timestamp;
	domain.save();
}

export function handleActionDomainRevoked(event: ActionDomainRevoked): void {
	const id = event.params.actionDomain.toHexString();
	let domain = ActionDomain.load(id);
	if (domain) {
		domain.isActive = false;
		domain.revokedAt = event.block.timestamp;
		domain.save();
	}
}

export function handleActionDomainMinAuthoritySet(
	event: ActionDomainMinAuthoritySet
): void {
	const id = event.params.actionDomain.toHexString();
	let domain = ActionDomain.load(id);
	if (domain) {
		domain.minAuthority = event.params.minLevel;
		domain.pendingMinAuthority = 0;
		domain.pendingExecuteTime = BigInt.fromI32(0);
		domain.save();
	}
}

export function handleMinAuthorityIncreaseProposed(
	event: MinAuthorityIncreaseProposed
): void {
	const id = event.params.actionDomain.toHexString();
	let domain = ActionDomain.load(id);
	if (domain) {
		domain.pendingMinAuthority = event.params.proposedLevel;
		domain.pendingExecuteTime = event.params.executeTime;
		domain.save();
	}

	const govId =
		event.transaction.hash.toHexString() + '-' + event.logIndex.toString();
	const gov = new GovernanceEvent(govId);
	gov.eventType = 'propose';
	gov.target = 'min_authority';
	gov.targetId = event.params.actionDomain;
	gov.executeTime = event.params.executeTime;
	gov.timestamp = event.block.timestamp;
	gov.save();
}

export function handleCampaignRegistryChangeProposed(
	event: CampaignRegistryChangeProposed
): void {
	const govId =
		event.transaction.hash.toHexString() + '-' + event.logIndex.toString();
	const gov = new GovernanceEvent(govId);
	gov.eventType = 'propose';
	gov.target = 'campaign_registry';
	gov.targetId = event.params.proposed;
	gov.executeTime = event.params.executeTime;
	gov.timestamp = event.block.timestamp;
	gov.save();
}

export function handleTwoTreeRegistriesProposed(
	event: TwoTreeRegistriesProposed
): void {
	const govId =
		event.transaction.hash.toHexString() + '-' + event.logIndex.toString();
	const gov = new GovernanceEvent(govId);
	gov.eventType = 'propose';
	gov.target = 'two_tree_registries';
	gov.executeTime = event.params.executeTime;
	gov.timestamp = event.block.timestamp;
	gov.save();
}
