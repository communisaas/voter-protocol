/**
 * Redistricting Tracker Tests - ISSUE-003
 *
 * Tests for redistricting event tracking and dual-validity period management.
 * Verifies that both old and new merkle roots are accepted during transitions
 * to prevent user disenfranchisement during court-ordered redistricting.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RedistrictingTracker,
  InMemoryRedistrictingStorage,
  getRedistrictingTracker,
  resetRedistrictingTracker,
  type RedistrictingEvent,
} from '../../../core/redistricting-tracker.js';
import {
  createRedistrictingNotification,
  formatRedistrictingMessage,
  formatRedistrictingTitle,
  isNotificationActive,
  daysRemainingInDualValidity,
} from '../../../core/redistricting-notifications.js';

describe('RedistrictingTracker', () => {
  let tracker: RedistrictingTracker;
  let storage: InMemoryRedistrictingStorage;

  beforeEach(() => {
    storage = new InMemoryRedistrictingStorage();
    tracker = new RedistrictingTracker({ storage });
    // Reset singleton for isolation
    resetRedistrictingTracker();
  });

  describe('registerEvent', () => {
    it('should create event with auto-generated id', async () => {
      const effectiveDate = new Date();
      const event = await tracker.registerEvent({
        stateFips: '06',
        stateName: 'California',
        districtType: 'congressional',
        effectiveDate,
        source: 'court_order',
        description: 'Test redistricting case',
        oldMerkleRoot: '0xold123',
        newMerkleRoot: '0xnew456',
      });

      expect(event.id).toContain('redistrict-06-');
      expect(event.stateFips).toBe('06');
      expect(event.stateName).toBe('California');
      expect(event.processed).toBe(false);
    });

    it('should create event with 30-day dual-validity period by default', async () => {
      const effectiveDate = new Date('2024-01-15T00:00:00Z');
      const event = await tracker.registerEvent({
        stateFips: '06',
        stateName: 'California',
        districtType: 'congressional',
        effectiveDate,
        source: 'court_order',
        description: 'Test redistricting case',
        oldMerkleRoot: '0xold123',
        newMerkleRoot: '0xnew456',
      });

      // Dual validity should be 30 days after effective date
      const expectedDualValidityUntil = new Date('2024-02-14T00:00:00Z');
      expect(event.dualValidityUntil.getTime()).toBe(expectedDualValidityUntil.getTime());
    });

    it('should use custom dual-validity duration when configured', async () => {
      const customStorage = new InMemoryRedistrictingStorage();
      const customDuration = 60 * 24 * 60 * 60 * 1000; // 60 days
      const customTracker = new RedistrictingTracker({
        storage: customStorage,
        dualValidityDuration: customDuration,
      });

      const effectiveDate = new Date('2024-01-15T00:00:00Z');
      const event = await customTracker.registerEvent({
        stateFips: '06',
        stateName: 'California',
        districtType: 'congressional',
        effectiveDate,
        source: 'legislative',
        description: 'Custom duration test',
        oldMerkleRoot: '0xold',
        newMerkleRoot: '0xnew',
      });

      const expectedDualValidityUntil = new Date('2024-03-15T00:00:00Z');
      expect(event.dualValidityUntil.getTime()).toBe(expectedDualValidityUntil.getTime());
    });

    it('should persist event to storage', async () => {
      const event = await tracker.registerEvent({
        stateFips: '48',
        stateName: 'Texas',
        districtType: 'state_senate',
        effectiveDate: new Date(),
        source: 'census',
        description: 'Census redistricting',
        oldMerkleRoot: '0xoldtx',
        newMerkleRoot: '0xnewtx',
      });

      const retrieved = await storage.getEvent(event.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.stateName).toBe('Texas');
    });
  });

  describe('isRootValid', () => {
    it('should accept current root', async () => {
      const result = await tracker.isRootValid('06', '0xcurrent', '0xcurrent');
      expect(result.valid).toBe(true);
      expect(result.reason).toBe('current_root');
    });

    it('should accept old root during dual-validity period', async () => {
      // Register an event that's currently in dual-validity
      const effectiveDate = new Date();
      await tracker.registerEvent({
        stateFips: '06',
        stateName: 'California',
        districtType: 'congressional',
        effectiveDate,
        source: 'court_order',
        description: 'Test case',
        oldMerkleRoot: '0xold',
        newMerkleRoot: '0xnew',
      });

      // Old root should be valid during dual-validity
      const result = await tracker.isRootValid('06', '0xold', '0xnew');
      expect(result.valid).toBe(true);
      expect(result.reason).toContain('dual_validity');
    });

    it('should reject invalid root', async () => {
      const result = await tracker.isRootValid('06', '0xinvalid', '0xcurrent');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_root');
    });

    it('should reject old root after dual-validity expires', async () => {
      // Create a custom storage and tracker
      const expiredStorage = new InMemoryRedistrictingStorage();

      // Manually create an expired event
      const expiredEvent: RedistrictingEvent = {
        id: 'redistrict-06-expired',
        stateFips: '06',
        stateName: 'California',
        districtType: 'congressional',
        effectiveDate: new Date('2023-01-01'),
        source: 'court_order',
        description: 'Expired event',
        oldMerkleRoot: '0xexpiredold',
        newMerkleRoot: '0xexpirednew',
        dualValidityUntil: new Date('2023-01-31'), // Already expired
        createdAt: new Date('2023-01-01'),
        processed: false,
      };
      await expiredStorage.saveEvent(expiredEvent);

      const expiredTracker = new RedistrictingTracker({ storage: expiredStorage });

      // Old root should be rejected after expiration
      const result = await expiredTracker.isRootValid('06', '0xexpiredold', '0xexpirednew');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_root');
    });

    it('should handle multiple events for same state', async () => {
      // Register two events
      await tracker.registerEvent({
        stateFips: '06',
        stateName: 'California',
        districtType: 'congressional',
        effectiveDate: new Date(),
        source: 'court_order',
        description: 'First redistricting',
        oldMerkleRoot: '0xfirst_old',
        newMerkleRoot: '0xfirst_new',
      });

      await tracker.registerEvent({
        stateFips: '06',
        stateName: 'California',
        districtType: 'state_senate',
        effectiveDate: new Date(),
        source: 'legislative',
        description: 'Second redistricting',
        oldMerkleRoot: '0xsecond_old',
        newMerkleRoot: '0xsecond_new',
      });

      // Both old roots should be valid
      const result1 = await tracker.isRootValid('06', '0xfirst_old', '0xcurrent');
      expect(result1.valid).toBe(true);

      const result2 = await tracker.isRootValid('06', '0xsecond_old', '0xcurrent');
      expect(result2.valid).toBe(true);
    });
  });

  describe('getActiveEvents', () => {
    it('should return only active events', async () => {
      // Register an active event
      await tracker.registerEvent({
        stateFips: '06',
        stateName: 'California',
        districtType: 'congressional',
        effectiveDate: new Date(),
        source: 'court_order',
        description: 'Active event',
        oldMerkleRoot: '0xactive_old',
        newMerkleRoot: '0xactive_new',
      });

      // Manually add an expired event
      const expiredEvent: RedistrictingEvent = {
        id: 'redistrict-48-expired',
        stateFips: '48',
        stateName: 'Texas',
        districtType: 'congressional',
        effectiveDate: new Date('2023-01-01'),
        source: 'census',
        description: 'Expired event',
        oldMerkleRoot: '0xexpired_old',
        newMerkleRoot: '0xexpired_new',
        dualValidityUntil: new Date('2023-01-31'),
        createdAt: new Date('2023-01-01'),
        processed: false,
      };
      await storage.saveEvent(expiredEvent);

      const activeEvents = await tracker.getActiveEvents();
      expect(activeEvents.length).toBe(1);
      expect(activeEvents[0].stateName).toBe('California');
    });
  });

  describe('getEventsForState', () => {
    it('should return all events for a state', async () => {
      await tracker.registerEvent({
        stateFips: '06',
        stateName: 'California',
        districtType: 'congressional',
        effectiveDate: new Date(),
        source: 'court_order',
        description: 'CA Event 1',
        oldMerkleRoot: '0x1',
        newMerkleRoot: '0x2',
      });

      await tracker.registerEvent({
        stateFips: '06',
        stateName: 'California',
        districtType: 'state_house',
        effectiveDate: new Date(),
        source: 'legislative',
        description: 'CA Event 2',
        oldMerkleRoot: '0x3',
        newMerkleRoot: '0x4',
      });

      await tracker.registerEvent({
        stateFips: '48',
        stateName: 'Texas',
        districtType: 'congressional',
        effectiveDate: new Date(),
        source: 'census',
        description: 'TX Event',
        oldMerkleRoot: '0x5',
        newMerkleRoot: '0x6',
      });

      const caEvents = await tracker.getEventsForState('06');
      expect(caEvents.length).toBe(2);

      const txEvents = await tracker.getEventsForState('48');
      expect(txEvents.length).toBe(1);
    });
  });

  describe('markEventProcessed', () => {
    it('should mark event as processed', async () => {
      const event = await tracker.registerEvent({
        stateFips: '06',
        stateName: 'California',
        districtType: 'congressional',
        effectiveDate: new Date(),
        source: 'court_order',
        description: 'Test',
        oldMerkleRoot: '0xold',
        newMerkleRoot: '0xnew',
      });

      expect(event.processed).toBe(false);

      await tracker.markEventProcessed(event.id);

      const updated = await storage.getEvent(event.id);
      expect(updated?.processed).toBe(true);
    });
  });

  describe('getDualValidityDuration', () => {
    it('should return configured duration', () => {
      const duration = tracker.getDualValidityDuration();
      expect(duration).toBe(30 * 24 * 60 * 60 * 1000); // 30 days default
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const tracker1 = getRedistrictingTracker();
      const tracker2 = getRedistrictingTracker();
      expect(tracker1).toBe(tracker2);
    });

    it('should reset singleton', () => {
      const tracker1 = getRedistrictingTracker();
      resetRedistrictingTracker();
      const tracker2 = getRedistrictingTracker();
      expect(tracker1).not.toBe(tracker2);
    });
  });
});

describe('InMemoryRedistrictingStorage', () => {
  let storage: InMemoryRedistrictingStorage;

  beforeEach(() => {
    storage = new InMemoryRedistrictingStorage();
  });

  it('should save and retrieve events', async () => {
    const event: RedistrictingEvent = {
      id: 'test-event',
      stateFips: '06',
      stateName: 'California',
      districtType: 'congressional',
      effectiveDate: new Date(),
      source: 'court_order',
      description: 'Test',
      oldMerkleRoot: '0xold',
      newMerkleRoot: '0xnew',
      dualValidityUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      processed: false,
    };

    await storage.saveEvent(event);
    const retrieved = await storage.getEvent('test-event');
    expect(retrieved).toEqual(event);
  });

  it('should return null for non-existent event', async () => {
    const result = await storage.getEvent('non-existent');
    expect(result).toBeNull();
  });
});

describe('RedistrictingNotifications', () => {
  const mockEvent: RedistrictingEvent = {
    id: 'redistrict-06-1234567890',
    stateFips: '06',
    stateName: 'California',
    districtType: 'congressional',
    effectiveDate: new Date('2024-01-15'),
    source: 'court_order',
    description: 'Smith v. California Redistricting Commission',
    oldMerkleRoot: '0xoldroot',
    newMerkleRoot: '0xnewroot',
    dualValidityUntil: new Date('2024-02-14'),
    createdAt: new Date('2024-01-10'),
    processed: false,
  };

  describe('createRedistrictingNotification', () => {
    it('should create notification payload', () => {
      const notification = createRedistrictingNotification(
        'user-123',
        mockEvent,
        'CD-12',
        'CD-13'
      );

      expect(notification.type).toBe('redistricting_alert');
      expect(notification.userId).toBe('user-123');
      expect(notification.oldDistrict).toBe('CD-12');
      expect(notification.newDistrict).toBe('CD-13');
      expect(notification.event.id).toBe(mockEvent.id);
      expect(notification.event.stateName).toBe('California');
      expect(notification.action.type).toBe('reverify');
      expect(notification.action.url).toContain('redistricting');
    });
  });

  describe('formatRedistrictingMessage', () => {
    it('should format human-readable message', () => {
      const notification = createRedistrictingNotification(
        'user-123',
        mockEvent,
        'CD-12',
        'CD-13'
      );
      const message = formatRedistrictingMessage(notification);

      expect(message).toContain('congressional district');
      expect(message).toContain('CD-12');
      expect(message).toContain('CD-13');
      expect(message).toContain('court order');
      // Date formatting varies by timezone, just check it contains February 2024
      expect(message).toContain('February');
      expect(message).toContain('2024');
      expect(message).toContain('re-verify');
    });

    it('should format different district types', () => {
      const senateMockEvent = { ...mockEvent, districtType: 'state_senate' as const };
      const notification = createRedistrictingNotification(
        'user-123',
        senateMockEvent,
        'SD-5',
        'SD-6'
      );
      const message = formatRedistrictingMessage(notification);

      expect(message).toContain('state senate district');
    });

    it('should format different sources', () => {
      const legislativeMockEvent = { ...mockEvent, source: 'legislative' as const };
      const notification = createRedistrictingNotification(
        'user-123',
        legislativeMockEvent,
        'CD-12',
        'CD-13'
      );
      const message = formatRedistrictingMessage(notification);

      expect(message).toContain('legislative action');
    });
  });

  describe('formatRedistrictingTitle', () => {
    it('should create notification title', () => {
      const notification = createRedistrictingNotification(
        'user-123',
        mockEvent,
        'CD-12',
        'CD-13'
      );
      const title = formatRedistrictingTitle(notification);

      expect(title).toBe('California Redistricting Alert');
    });
  });

  describe('isNotificationActive', () => {
    it('should return true for future dual-validity', () => {
      const futureEvent = {
        ...mockEvent,
        dualValidityUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      };
      const notification = createRedistrictingNotification(
        'user-123',
        futureEvent,
        'CD-12',
        'CD-13'
      );

      expect(isNotificationActive(notification)).toBe(true);
    });

    it('should return false for expired dual-validity', () => {
      const expiredEvent = {
        ...mockEvent,
        dualValidityUntil: new Date('2023-01-01'),
      };
      const notification = createRedistrictingNotification(
        'user-123',
        expiredEvent,
        'CD-12',
        'CD-13'
      );

      expect(isNotificationActive(notification)).toBe(false);
    });
  });

  describe('daysRemainingInDualValidity', () => {
    it('should calculate days remaining', () => {
      // Create event with exactly 10 days remaining
      const tenDaysFromNow = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const futureEvent = {
        ...mockEvent,
        dualValidityUntil: tenDaysFromNow,
      };
      const notification = createRedistrictingNotification(
        'user-123',
        futureEvent,
        'CD-12',
        'CD-13'
      );

      const days = daysRemainingInDualValidity(notification);
      expect(days).toBe(10);
    });

    it('should return 0 for expired', () => {
      const expiredEvent = {
        ...mockEvent,
        dualValidityUntil: new Date('2023-01-01'),
      };
      const notification = createRedistrictingNotification(
        'user-123',
        expiredEvent,
        'CD-12',
        'CD-13'
      );

      expect(daysRemainingInDualValidity(notification)).toBe(0);
    });
  });
});
