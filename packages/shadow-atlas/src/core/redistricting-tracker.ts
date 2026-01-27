/**
 * Redistricting Event Tracker
 *
 * Tracks redistricting events and manages dual-validity periods.
 * When a redistricting event occurs (court order, legislative action),
 * both the old and new district boundaries remain valid for 30 days.
 *
 * This prevents users from being disenfranchised during boundary transitions.
 *
 * Background:
 * - Court-ordered redistricting can invalidate proofs mid-term
 * - TIGER update lag is typically 2-4 months
 * - Solution: Dual-validity period where both old AND new merkle roots are valid
 */

export type RedistrictingSource = 'court_order' | 'legislative' | 'census' | 'manual';

export interface RedistrictingEvent {
  /** Unique event identifier */
  id: string;

  /** State FIPS code (e.g., '06' for California) */
  stateFips: string;

  /** State name for display */
  stateName: string;

  /** District type affected (e.g., 'congressional', 'state_senate') */
  districtType: 'congressional' | 'state_senate' | 'state_house' | 'school' | 'other';

  /** When the new boundaries take effect */
  effectiveDate: Date;

  /** Source of the redistricting order */
  source: RedistrictingSource;

  /** Description of the redistricting (court case name, bill number, etc.) */
  description: string;

  /** IPFS hash of old boundaries merkle root */
  oldMerkleRoot: string;

  /** IPFS hash of new boundaries merkle root */
  newMerkleRoot: string;

  /** End of dual-validity period (typically 30 days after effectiveDate) */
  dualValidityUntil: Date;

  /** Event creation timestamp */
  createdAt: Date;

  /** Whether this event has been fully processed */
  processed: boolean;
}

export interface RedistrictingConfig {
  /** Duration of dual-validity period in milliseconds (default: 30 days) */
  dualValidityDuration: number;

  /** Storage backend for events */
  storage: RedistrictingStorage;
}

export interface RedistrictingStorage {
  saveEvent(event: RedistrictingEvent): Promise<void>;
  getEvent(id: string): Promise<RedistrictingEvent | null>;
  getActiveEvents(): Promise<RedistrictingEvent[]>;
  getEventsForState(stateFips: string): Promise<RedistrictingEvent[]>;
}

/**
 * In-memory storage for redistricting events.
 * Replace with database-backed storage in production.
 */
export class InMemoryRedistrictingStorage implements RedistrictingStorage {
  private events: Map<string, RedistrictingEvent> = new Map();

  async saveEvent(event: RedistrictingEvent): Promise<void> {
    this.events.set(event.id, event);
  }

  async getEvent(id: string): Promise<RedistrictingEvent | null> {
    return this.events.get(id) ?? null;
  }

  async getActiveEvents(): Promise<RedistrictingEvent[]> {
    const now = new Date();
    return Array.from(this.events.values()).filter((e) => e.dualValidityUntil > now);
  }

  async getEventsForState(stateFips: string): Promise<RedistrictingEvent[]> {
    return Array.from(this.events.values()).filter((e) => e.stateFips === stateFips);
  }
}

/** Default dual-validity duration: 30 days in milliseconds */
const DEFAULT_DUAL_VALIDITY_DURATION = 30 * 24 * 60 * 60 * 1000;

export interface RootValidationResult {
  valid: boolean;
  reason: 'current_root' | 'invalid_root' | `dual_validity:${string}`;
}

export class RedistrictingTracker {
  private config: RedistrictingConfig;

  constructor(config?: Partial<RedistrictingConfig>) {
    this.config = {
      dualValidityDuration: config?.dualValidityDuration ?? DEFAULT_DUAL_VALIDITY_DURATION,
      storage: config?.storage ?? new InMemoryRedistrictingStorage(),
    };
  }

  /**
   * Register a new redistricting event.
   *
   * @param params - Event parameters (id, dualValidityUntil, createdAt, processed are auto-generated)
   * @returns The created redistricting event
   */
  async registerEvent(
    params: Omit<RedistrictingEvent, 'id' | 'dualValidityUntil' | 'createdAt' | 'processed'>
  ): Promise<RedistrictingEvent> {
    // Generate unique ID with timestamp and random suffix to avoid collisions
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const event: RedistrictingEvent = {
      ...params,
      id: `redistrict-${params.stateFips}-${Date.now()}-${randomSuffix}`,
      dualValidityUntil: new Date(params.effectiveDate.getTime() + this.config.dualValidityDuration),
      createdAt: new Date(),
      processed: false,
    };

    await this.config.storage.saveEvent(event);
    console.log(
      `[RedistrictingTracker] Registered event ${event.id} for ${event.stateName} ` +
        `(dual-validity until ${event.dualValidityUntil.toISOString()})`
    );

    return event;
  }

  /**
   * Check if a merkle root is valid for a state.
   * Returns true if it matches either current or previous root during dual-validity.
   *
   * @param stateFips - State FIPS code to check
   * @param merkleRoot - The merkle root being validated
   * @param currentRoot - The current (latest) merkle root for the state
   * @returns Validation result with reason
   */
  async isRootValid(
    stateFips: string,
    merkleRoot: string,
    currentRoot: string
  ): Promise<RootValidationResult> {
    // Check current root first
    if (merkleRoot === currentRoot) {
      return { valid: true, reason: 'current_root' };
    }

    // Check if we're in a dual-validity period
    const events = await this.config.storage.getEventsForState(stateFips);
    const now = new Date();

    for (const event of events) {
      if (event.dualValidityUntil > now) {
        // In dual-validity period - check old root
        if (merkleRoot === event.oldMerkleRoot) {
          return {
            valid: true,
            reason: `dual_validity:${event.id}`,
          };
        }
      }
    }

    return { valid: false, reason: 'invalid_root' };
  }

  /**
   * Get all currently active redistricting events.
   * An event is active if we're still within its dual-validity period.
   */
  async getActiveEvents(): Promise<RedistrictingEvent[]> {
    return this.config.storage.getActiveEvents();
  }

  /**
   * Get redistricting events for a specific state.
   *
   * @param stateFips - State FIPS code
   */
  async getEventsForState(stateFips: string): Promise<RedistrictingEvent[]> {
    return this.config.storage.getEventsForState(stateFips);
  }

  /**
   * Mark an event as processed.
   * This is called after all affected users have been notified.
   *
   * @param eventId - The event ID to mark as processed
   */
  async markEventProcessed(eventId: string): Promise<void> {
    const event = await this.config.storage.getEvent(eventId);
    if (event) {
      event.processed = true;
      await this.config.storage.saveEvent(event);
      console.log(`[RedistrictingTracker] Marked event ${eventId} as processed`);
    }
  }

  /**
   * Get affected districts for notification.
   * Returns district IDs whose boundaries changed.
   *
   * Note: Implementation depends on how district-user mapping is stored.
   * This is a placeholder that should be overridden in production.
   *
   * @param event - The redistricting event
   * @returns Array of affected district identifiers
   */
  async getAffectedDistricts(event: RedistrictingEvent): Promise<string[]> {
    // This would query the database for districts affected by the boundary change
    // Implementation depends on how district-user mapping is stored
    console.log(`[RedistrictingTracker] Getting affected districts for ${event.id}`);
    return [];
  }

  /**
   * Get the configured dual-validity duration.
   */
  getDualValidityDuration(): number {
    return this.config.dualValidityDuration;
  }
}

// Singleton instance
let tracker: RedistrictingTracker | null = null;

/**
 * Get the singleton RedistrictingTracker instance.
 * Creates a new instance with default config if none exists.
 */
export function getRedistrictingTracker(): RedistrictingTracker {
  if (!tracker) {
    tracker = new RedistrictingTracker();
  }
  return tracker;
}

/**
 * Reset the singleton tracker.
 * Primarily used for testing.
 */
export function resetRedistrictingTracker(): void {
  tracker = null;
}
