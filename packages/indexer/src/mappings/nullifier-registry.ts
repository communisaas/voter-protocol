/**
 * NullifierRegistry Event Handlers (Wave 15c)
 *
 * Indexes nullifier submissions and action creation events.
 */

import { BigInt } from '@graphprotocol/graph-ts';
import {
	ActionCreated,
	ActionSubmitted
} from '../../generated/NullifierRegistry/NullifierRegistry';
import { NullifierAction, NullifierSubmission } from '../../generated/schema';

export function handleActionCreated(event: ActionCreated): void {
	const id = event.params.actionId.toHexString();
	const action = new NullifierAction(id);

	action.participantCount = BigInt.fromI32(0);
	action.createdAt = event.params.timestamp;
	action.lastSubmission = event.params.timestamp;

	action.save();
}

export function handleActionSubmitted(event: ActionSubmitted): void {
	// Create submission record
	const submissionId =
		event.params.actionId.toHexString() +
		'-' +
		event.params.nullifier.toHexString();

	const submission = new NullifierSubmission(submissionId);
	submission.action = event.params.actionId.toHexString();
	submission.nullifier = event.params.nullifier;
	submission.merkleRoot = event.params.merkleRoot;
	submission.timestamp = event.params.timestamp;
	submission.save();

	// Update action counters
	const actionId = event.params.actionId.toHexString();
	let action = NullifierAction.load(actionId);
	if (!action) {
		// ActionCreated may not have fired yet in same block
		action = new NullifierAction(actionId);
		action.participantCount = BigInt.fromI32(0);
		action.createdAt = event.params.timestamp;
	}
	action.participantCount = action.participantCount.plus(BigInt.fromI32(1));
	action.lastSubmission = event.params.timestamp;
	action.save();
}
