/**
 * Redistricting Notification Types
 *
 * Defines notification payloads for redistricting events.
 * These are sent to affected users when their district boundaries change.
 */

import type { RedistrictingEvent, RedistrictingSource } from './redistricting-tracker.js';

export interface RedistrictingNotification {
  type: 'redistricting_alert';
  userId: string;
  event: {
    id: string;
    stateName: string;
    districtType: string;
    effectiveDate: string;
    source: RedistrictingSource;
    description: string;
  };
  oldDistrict: string;
  newDistrict: string;
  dualValidityUntil: string;
  action: {
    type: 'reverify';
    label: string;
    url: string;
  };
}

/**
 * Create a notification payload for a redistricting event.
 *
 * @param userId - The user ID to notify
 * @param event - The redistricting event
 * @param oldDistrict - The user's previous district identifier
 * @param newDistrict - The user's new district identifier
 * @returns A structured notification payload
 */
export function createRedistrictingNotification(
  userId: string,
  event: RedistrictingEvent,
  oldDistrict: string,
  newDistrict: string
): RedistrictingNotification {
  return {
    type: 'redistricting_alert',
    userId,
    event: {
      id: event.id,
      stateName: event.stateName,
      districtType: event.districtType,
      effectiveDate: event.effectiveDate.toISOString(),
      source: event.source,
      description: event.description,
    },
    oldDistrict,
    newDistrict,
    dualValidityUntil: event.dualValidityUntil.toISOString(),
    action: {
      type: 'reverify',
      label: 'Re-verify Your Address',
      url: '/settings/verification?reason=redistricting',
    },
  };
}

/**
 * Format a source type for human-readable display.
 */
function formatSource(source: RedistrictingSource): string {
  switch (source) {
    case 'court_order':
      return 'a court order';
    case 'legislative':
      return 'legislative action';
    case 'census':
      return 'census redistricting';
    case 'manual':
      return 'an administrative update';
    default:
      return source;
  }
}

/**
 * Format a district type for human-readable display.
 */
function formatDistrictType(
  districtType: 'congressional' | 'state_senate' | 'state_house' | 'school' | 'other'
): string {
  switch (districtType) {
    case 'congressional':
      return 'congressional district';
    case 'state_senate':
      return 'state senate district';
    case 'state_house':
      return 'state house district';
    case 'school':
      return 'school district';
    case 'other':
      return 'district';
    default:
      return districtType;
  }
}

/**
 * Generate a user-facing message for a redistricting notification.
 *
 * @param notification - The notification payload
 * @returns A human-readable message explaining the redistricting
 */
export function formatRedistrictingMessage(notification: RedistrictingNotification): string {
  const { event, oldDistrict, newDistrict, dualValidityUntil } = notification;
  const validUntil = new Date(dualValidityUntil).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const districtTypeDisplay = formatDistrictType(
    event.districtType as 'congressional' | 'state_senate' | 'state_house' | 'school' | 'other'
  );
  const sourceDisplay = formatSource(event.source);

  return (
    `Your ${districtTypeDisplay} has changed from ${oldDistrict} to ${newDistrict} ` +
    `due to ${sourceDisplay}. ` +
    `Both districts will be accepted until ${validUntil}. ` +
    `Please re-verify your address to ensure uninterrupted service.`
  );
}

/**
 * Generate a short notification title.
 *
 * @param notification - The notification payload
 * @returns A short title for the notification
 */
export function formatRedistrictingTitle(notification: RedistrictingNotification): string {
  return `${notification.event.stateName} Redistricting Alert`;
}

/**
 * Check if a notification is still within the dual-validity period.
 *
 * @param notification - The notification to check
 * @returns true if still in dual-validity period
 */
export function isNotificationActive(notification: RedistrictingNotification): boolean {
  const dualValidityUntil = new Date(notification.dualValidityUntil);
  return dualValidityUntil > new Date();
}

/**
 * Calculate days remaining in dual-validity period.
 *
 * @param notification - The notification to check
 * @returns Number of days remaining (0 if expired)
 */
export function daysRemainingInDualValidity(notification: RedistrictingNotification): number {
  const dualValidityUntil = new Date(notification.dualValidityUntil);
  const now = new Date();
  const diffMs = dualValidityUntil.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}
