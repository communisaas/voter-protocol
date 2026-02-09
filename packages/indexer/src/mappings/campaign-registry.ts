/**
 * CampaignRegistry Event Handlers (Wave 15c)
 *
 * Indexes campaign lifecycle and participation events.
 */

import { BigInt } from '@graphprotocol/graph-ts';
import {
	CampaignCreated,
	CampaignStatusChanged,
	ParticipantRecorded,
	CampaignFlagged
} from '../../generated/CampaignRegistry/CampaignRegistry';
import { Campaign, Participation } from '../../generated/schema';

const STATUS_MAP = ['Active', 'Paused', 'Completed'];

export function handleCampaignCreated(event: CampaignCreated): void {
	const id = event.params.campaignId.toHexString();
	const campaign = new Campaign(id);

	campaign.creator = event.params.creator;
	campaign.country = event.params.country;
	campaign.ipfsMetadataHash = event.params.ipfsMetadataHash;
	campaign.templateCount = event.params.templateCount;
	campaign.status = 'Active';
	campaign.participantCount = BigInt.fromI32(0);
	campaign.districtCount = BigInt.fromI32(0);
	campaign.flagReason = null;
	campaign.createdAt = event.block.timestamp;
	campaign.updatedAt = event.block.timestamp;

	campaign.save();
}

export function handleCampaignStatusChanged(event: CampaignStatusChanged): void {
	const id = event.params.campaignId.toHexString();
	const campaign = Campaign.load(id);
	if (!campaign) return;

	const newStatusIdx = event.params.newStatus;
	campaign.status =
		newStatusIdx < STATUS_MAP.length
			? STATUS_MAP[newStatusIdx]
			: 'Unknown';
	campaign.updatedAt = event.block.timestamp;
	campaign.save();
}

export function handleParticipantRecorded(event: ParticipantRecorded): void {
	const campaignId = event.params.campaignId.toHexString();
	const id =
		campaignId +
		'-' +
		event.params.actionId.toHexString() +
		'-' +
		event.params.districtRoot.toHexString();

	const participation = new Participation(id);
	participation.campaign = campaignId;
	participation.actionId = event.params.actionId;
	participation.districtRoot = event.params.districtRoot;
	participation.newDistrict = event.params.newDistrict;
	participation.timestamp = event.block.timestamp;
	participation.save();

	// Update campaign counters
	const campaign = Campaign.load(campaignId);
	if (campaign) {
		campaign.participantCount = campaign.participantCount.plus(BigInt.fromI32(1));
		if (event.params.newDistrict) {
			campaign.districtCount = campaign.districtCount.plus(BigInt.fromI32(1));
		}
		campaign.updatedAt = event.block.timestamp;
		campaign.save();
	}
}

export function handleCampaignFlagged(event: CampaignFlagged): void {
	const id = event.params.campaignId.toHexString();
	const campaign = Campaign.load(id);
	if (!campaign) return;

	campaign.status = 'Flagged';
	campaign.flagReason = event.params.reason;
	campaign.updatedAt = event.block.timestamp;
	campaign.save();
}
