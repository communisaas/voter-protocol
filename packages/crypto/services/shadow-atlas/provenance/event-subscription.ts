/**
 * Event Subscription Service - WP-FRESHNESS-4
 *
 * Monitors data sources for freshness changes and emits events for Shadow Atlas refresh.
 *
 * MONITORING STRATEGIES:
 * 1. RSS Feed Monitoring: Census TIGER releases, state redistricting commissions
 * 2. Webhook Registration: Allow external systems to subscribe to freshness events
 * 3. Polling Fallback: Smart HTTP HEAD polling using primary-comparator for sources without RSS
 *
 * CRITICAL TYPE SAFETY: Events drive Shadow Atlas refresh. Type errors here can cause
 * stale data propagation or missed updates during redistricting cycles.
 *
 * Integration Points:
 * - validity-window.ts: Calculates data freshness windows
 * - primary-comparator.ts: HTTP HEAD comparisons for polling
 * - gap-detector.ts: Redistricting gap period detection
 * - authority-registry.ts: Source URLs and metadata
 */

import type { BoundaryType } from './validity-window.js';
import { validityWindowCalculator } from './validity-window.js';
import { primaryComparator } from './primary-comparator.js';
import type { SourceFreshness } from './primary-comparator.js';
import { gapDetector } from './gap-detector.js';
import type { GapBoundaryType } from './gap-detector.js';
import { authorityRegistry } from './authority-registry.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Source type for event monitoring
 */
export type SourceType = 'tiger' | 'primary' | 'aggregator';

/**
 * Freshness event types
 */
export type FreshnessEvent =
  | {
      readonly type: 'source-updated';
      readonly source: SourceType;
      readonly jurisdiction?: string;
      readonly newDate: Date;
      readonly boundaryType?: BoundaryType;
      readonly url: string;
      readonly etag?: string;
    }
  | {
      readonly type: 'gap-entered';
      readonly cycle: number;
      readonly affectedBoundaries: readonly BoundaryType[];
      readonly affectedStates: readonly string[];
    }
  | {
      readonly type: 'gap-exited';
      readonly cycle: number;
      readonly tigerUpdated: boolean;
      readonly affectedBoundaries: readonly BoundaryType[];
    }
  | {
      readonly type: 'staleness-warning';
      readonly source: string;
      readonly jurisdiction?: string;
      readonly boundaryType?: BoundaryType;
      readonly daysUntilStale: number;
      readonly confidence: number;
    };

/**
 * RSS feed entry
 */
interface RSSFeedEntry {
  readonly title: string;
  readonly link: string;
  readonly pubDate: Date;
  readonly description?: string;
  readonly guid?: string;
}

/**
 * RSS feed metadata
 */
interface RSSFeed {
  readonly url: string;
  readonly title: string;
  readonly link: string;
  readonly description: string;
  readonly lastBuildDate?: Date;
  readonly entries: readonly RSSFeedEntry[];
}

/**
 * Webhook subscription configuration
 */
interface WebhookSubscription {
  readonly id: string;
  readonly url: string;
  readonly eventTypes: readonly FreshnessEvent['type'][];
  readonly boundaryTypes?: readonly BoundaryType[];
  readonly jurisdictions?: readonly string[];
  readonly secret?: string;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly lastDelivered?: Date;
}

/**
 * Webhook delivery result
 */
interface WebhookDeliveryResult {
  readonly subscriptionId: string;
  readonly success: boolean;
  readonly statusCode?: number;
  readonly error?: string;
  readonly deliveredAt: Date;
}

/**
 * Polling configuration
 */
interface PollingConfig {
  readonly url: string;
  readonly boundaryType: BoundaryType;
  readonly jurisdiction?: string;
  readonly intervalMs: number;
  readonly lastPolled?: Date;
  readonly lastETag?: string;
  readonly lastModified?: Date;
  readonly consecutiveFailures: number;
}

/**
 * Polling state
 */
interface PollingState {
  readonly config: PollingConfig;
  readonly nextPollAt: Date;
  readonly backoffMs: number;
}

// ============================================================================
// Event Subscription Service
// ============================================================================

/**
 * Event Subscription Service
 *
 * Monitors data sources for freshness changes:
 * 1. RSS feeds (Census TIGER, state redistricting commissions)
 * 2. Webhooks (external systems can subscribe)
 * 3. HTTP HEAD polling (fallback for sources without RSS)
 */
export class EventSubscriptionService {
  private readonly webhooks: Map<string, WebhookSubscription> = new Map();
  private readonly pollingStates: Map<string, PollingState> = new Map();
  private readonly eventListeners: Array<(event: FreshnessEvent) => void> = [];

  private readonly rssFeedUrls: Map<SourceType, readonly string[]> = new Map([
    ['tiger', ['https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/tiger-geo-line.rss']],
    // State redistricting commissions typically don't have RSS feeds
    // We'll use HTTP HEAD polling for these
    ['primary', []],
  ]);

  private readonly maxRetries = 3;
  private readonly initialRetryDelayMs = 1000;
  private readonly maxBackoffMs = 300000; // 5 minutes
  private readonly defaultPollingIntervalMs = 3600000; // 1 hour
  private readonly feedFetchTimeoutMs = 10000; // 10 seconds

  /**
   * Register an event listener
   * Receives all freshness events
   */
  addEventListener(listener: (event: FreshnessEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove an event listener
   */
  removeEventListener(listener: (event: FreshnessEvent) => void): void {
    const index = this.eventListeners.indexOf(listener);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Emit a freshness event to all listeners and webhooks
   */
  private async emitEvent(event: FreshnessEvent): Promise<void> {
    // Notify in-process listeners
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Event listener error:', error);
      }
    }

    // Deliver to webhooks
    await this.deliverToWebhooks(event);
  }

  // ============================================================================
  // RSS Feed Monitoring
  // ============================================================================

  /**
   * Monitor RSS feeds for updates
   * Checks Census TIGER release feeds
   */
  async monitorRSSFeeds(): Promise<ReadonlyMap<string, RSSFeed>> {
    const feeds = new Map<string, RSSFeed>();

    for (const [sourceType, urls] of Array.from(this.rssFeedUrls.entries())) {
      for (const url of urls) {
        try {
          const feed = await this.fetchRSSFeed(url);
          feeds.set(url, feed);

          // Check for new entries and emit events
          await this.processRSSFeed(feed, sourceType);
        } catch (error) {
          console.error(`Failed to fetch RSS feed ${url}:`, error);
        }
      }
    }

    return feeds;
  }

  /**
   * Fetch and parse RSS feed
   * Supports both RSS 2.0 and Atom formats
   */
  private async fetchRSSFeed(url: string): Promise<RSSFeed> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.feedFetchTimeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0 (Freshness Monitor)',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xml = await response.text();
      return this.parseRSSFeed(xml, url);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Parse RSS/Atom XML feed
   * Basic XML parsing without external dependencies
   */
  private parseRSSFeed(xml: string, feedUrl: string): RSSFeed {
    // Simple regex-based XML parsing (good enough for RSS/Atom)
    // In production, consider using a proper XML parser

    const getTagContent = (tag: string, content: string): string | null => {
      const match = content.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i'));
      return match ? match[1].trim() : null;
    };

    const getAllTagContent = (tag: string, content: string): string[] => {
      const regex = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'gi');
      const matches: string[] = [];
      let match;
      while ((match = regex.exec(content)) !== null) {
        matches.push(match[1].trim());
      }
      return matches;
    };

    const title = getTagContent('title', xml) || 'Unknown Feed';
    const link = getTagContent('link', xml) || feedUrl;
    const description = getTagContent('description', xml) || '';
    const lastBuildDateStr = getTagContent('lastBuildDate', xml);
    const lastBuildDate = lastBuildDateStr ? new Date(lastBuildDateStr) : undefined;

    // Extract items/entries
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;

    const entries: RSSFeedEntry[] = [];

    // Try RSS format
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const itemTitle = getTagContent('title', itemXml) || 'Untitled';
      const itemLink = getTagContent('link', itemXml) || '';
      const pubDateStr = getTagContent('pubDate', itemXml);
      const itemDescription = getTagContent('description', itemXml);
      const guid = getTagContent('guid', itemXml);

      entries.push({
        title: itemTitle,
        link: itemLink,
        pubDate: pubDateStr ? new Date(pubDateStr) : new Date(),
        description: itemDescription || undefined,
        guid: guid || undefined,
      });
    }

    // Try Atom format
    while ((match = entryRegex.exec(xml)) !== null) {
      const entryXml = match[1];
      const entryTitle = getTagContent('title', entryXml) || 'Untitled';
      const entryLink = getTagContent('link', entryXml) || '';
      const updatedStr = getTagContent('updated', entryXml);
      const entrySummary = getTagContent('summary', entryXml);
      const id = getTagContent('id', entryXml);

      entries.push({
        title: entryTitle,
        link: entryLink,
        pubDate: updatedStr ? new Date(updatedStr) : new Date(),
        description: entrySummary || undefined,
        guid: id || undefined,
      });
    }

    return {
      url: feedUrl,
      title,
      link,
      description,
      lastBuildDate,
      entries,
    };
  }

  /**
   * Process RSS feed for new updates
   * Emits source-updated events for new entries
   */
  private async processRSSFeed(feed: RSSFeed, sourceType: SourceType): Promise<void> {
    // For TIGER feeds, look for keywords indicating new releases
    const releaseKeywords = [
      'TIGER',
      'shapefile',
      'release',
      'congressional district',
      'CD',
      'SLDU',
      'SLDL',
    ];

    for (const entry of feed.entries) {
      const hasRelevantKeyword = releaseKeywords.some(keyword =>
        entry.title.toLowerCase().includes(keyword.toLowerCase()) ||
        (entry.description?.toLowerCase().includes(keyword.toLowerCase()) ?? false)
      );

      if (hasRelevantKeyword) {
        // Extract year from title/description if possible
        const yearMatch = entry.title.match(/\b(20\d{2})\b/) ||
                         entry.description?.match(/\b(20\d{2})\b/);

        // Emit source-updated event
        await this.emitEvent({
          type: 'source-updated',
          source: sourceType,
          newDate: entry.pubDate,
          url: entry.link,
        });
      }
    }
  }

  // ============================================================================
  // Webhook Registration and Delivery
  // ============================================================================

  /**
   * Register a webhook for freshness events
   * Supports filtering by event type, boundary type, and jurisdiction
   */
  registerWebhook(
    url: string,
    eventTypes: readonly FreshnessEvent['type'][],
    options?: {
      readonly boundaryTypes?: readonly BoundaryType[];
      readonly jurisdictions?: readonly string[];
      readonly secret?: string;
    }
  ): string {
    const id = this.generateWebhookId();
    const subscription: WebhookSubscription = {
      id,
      url,
      eventTypes,
      boundaryTypes: options?.boundaryTypes,
      jurisdictions: options?.jurisdictions,
      secret: options?.secret,
      active: true,
      createdAt: new Date(),
    };

    this.webhooks.set(id, subscription);
    return id;
  }

  /**
   * Unregister a webhook
   */
  unregisterWebhook(id: string): boolean {
    return this.webhooks.delete(id);
  }

  /**
   * Get all registered webhooks
   */
  getWebhooks(): readonly WebhookSubscription[] {
    return Array.from(this.webhooks.values());
  }

  /**
   * Deliver event to matching webhooks
   */
  private async deliverToWebhooks(event: FreshnessEvent): Promise<readonly WebhookDeliveryResult[]> {
    const results: WebhookDeliveryResult[] = [];

    for (const [id, subscription] of Array.from(this.webhooks.entries())) {
      if (!subscription.active) {
        continue;
      }

      // Check if event type matches
      if (!subscription.eventTypes.includes(event.type)) {
        continue;
      }

      // Check boundary type filter
      if (subscription.boundaryTypes && 'boundaryType' in event && event.boundaryType) {
        if (!subscription.boundaryTypes.includes(event.boundaryType)) {
          continue;
        }
      }

      // Check jurisdiction filter
      if (subscription.jurisdictions && 'jurisdiction' in event && event.jurisdiction) {
        if (!subscription.jurisdictions.includes(event.jurisdiction)) {
          continue;
        }
      }

      // Deliver webhook
      const result = await this.deliverWebhook(subscription, event);
      results.push(result);
    }

    return results;
  }

  /**
   * Deliver webhook with retry logic
   */
  private async deliverWebhook(
    subscription: WebhookSubscription,
    event: FreshnessEvent
  ): Promise<WebhookDeliveryResult> {
    const payload = {
      event,
      timestamp: new Date().toISOString(),
      subscription_id: subscription.id,
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(subscription.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0 (Webhook)',
            ...(subscription.secret
              ? { 'X-Webhook-Secret': subscription.secret }
              : {}),
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          // Update last delivered timestamp
          const updated = { ...subscription, lastDelivered: new Date() };
          this.webhooks.set(subscription.id, updated);

          return {
            subscriptionId: subscription.id,
            success: true,
            statusCode: response.status,
            deliveredAt: new Date(),
          };
        }

        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        lastError = error as Error;
      }

      // Wait before retry
      if (attempt < this.maxRetries) {
        await this.sleep(this.initialRetryDelayMs * Math.pow(2, attempt - 1));
      }
    }

    return {
      subscriptionId: subscription.id,
      success: false,
      error: lastError?.message || 'Unknown error',
      deliveredAt: new Date(),
    };
  }

  // ============================================================================
  // Polling Fallback
  // ============================================================================

  /**
   * Initialize polling for sources without RSS feeds
   * Uses HTTP HEAD requests via primary-comparator
   */
  async initializePolling(
    boundaryType: BoundaryType,
    jurisdiction?: string,
    intervalMs?: number
  ): Promise<string> {
    const url = this.getSourceUrl(boundaryType, jurisdiction);
    const pollingId = this.generatePollingId(boundaryType, jurisdiction);

    const config: PollingConfig = {
      url,
      boundaryType,
      jurisdiction,
      intervalMs: intervalMs || this.defaultPollingIntervalMs,
      consecutiveFailures: 0,
    };

    const state: PollingState = {
      config,
      nextPollAt: new Date(Date.now() + config.intervalMs),
      backoffMs: 0,
    };

    this.pollingStates.set(pollingId, state);
    return pollingId;
  }

  /**
   * Execute polling for a source
   * Uses primary-comparator for HTTP HEAD checks
   */
  async pollSource(pollingId: string): Promise<SourceFreshness | null> {
    const state = this.pollingStates.get(pollingId);
    if (!state) {
      return null;
    }

    const { config } = state;

    try {
      // Use primary-comparator to check freshness
      const freshness = await primaryComparator.checkSourceFreshness(config.url);

      // Check if source has been updated
      const hasUpdate = this.detectUpdate(config, freshness);

      // Update config with new metadata
      const updatedConfig: PollingConfig = {
        ...config,
        lastPolled: new Date(),
        lastETag: freshness.etag || config.lastETag,
        lastModified: freshness.lastModified || config.lastModified,
        consecutiveFailures: 0,
      };

      this.pollingStates.set(pollingId, {
        ...state,
        config: updatedConfig,
        nextPollAt: new Date(Date.now() + updatedConfig.intervalMs),
        backoffMs: 0,
      });

      if (hasUpdate) {
        await this.emitEvent({
          type: 'source-updated',
          source: config.jurisdiction ? 'primary' : 'tiger',
          jurisdiction: config.jurisdiction,
          boundaryType: config.boundaryType,
          newDate: freshness.lastModified || freshness.checkedAt,
          url: config.url,
          etag: freshness.etag || undefined,
        });
      }

      return freshness;
    } catch (error) {
      // Handle failure with exponential backoff
      const updatedConfig: PollingConfig = {
        ...config,
        consecutiveFailures: config.consecutiveFailures + 1,
      };

      const backoffMs = Math.min(
        this.initialRetryDelayMs * Math.pow(2, updatedConfig.consecutiveFailures),
        this.maxBackoffMs
      );

      this.pollingStates.set(pollingId, {
        ...state,
        config: updatedConfig,
        nextPollAt: new Date(Date.now() + config.intervalMs + backoffMs),
        backoffMs,
      });

      console.error(`Polling failed for ${pollingId}:`, error);
      return null;
    }
  }

  /**
   * Detect if source has been updated
   * Compares ETag and Last-Modified headers
   */
  private detectUpdate(config: PollingConfig, freshness: SourceFreshness): boolean {
    // First poll - no comparison possible
    if (!config.lastPolled) {
      return false;
    }

    // ETag changed
    if (config.lastETag && freshness.etag && config.lastETag !== freshness.etag) {
      return true;
    }

    // Last-Modified changed
    if (
      config.lastModified &&
      freshness.lastModified &&
      freshness.lastModified.getTime() > config.lastModified.getTime()
    ) {
      return true;
    }

    return false;
  }

  /**
   * Get all polling states
   */
  getPollingStates(): ReadonlyMap<string, PollingState> {
    return new Map(this.pollingStates);
  }

  /**
   * Stop polling for a source
   */
  stopPolling(pollingId: string): boolean {
    return this.pollingStates.delete(pollingId);
  }

  // ============================================================================
  // Gap Detection Integration
  // ============================================================================

  /**
   * Check for redistricting gaps and emit events
   * Should be called periodically (e.g., daily)
   */
  async checkRedistrictingGaps(asOf: Date = new Date()): Promise<void> {
    const isInGap = gapDetector.isInGap(asOf);
    const cycle = gapDetector.getCurrentCycle(asOf);

    if (!cycle) {
      return;
    }

    // Check if we just entered gap period
    const yesterday = new Date(asOf.getTime() - 24 * 60 * 60 * 1000);
    const wasInGap = gapDetector.isInGap(yesterday);

    if (isInGap && !wasInGap) {
      // Just entered gap
      const statesInGap = gapDetector.getStatesInGap(asOf);
      const affectedBoundaries: BoundaryType[] = [
        'congressional',
        'state_senate',
        'state_house',
      ];

      await this.emitEvent({
        type: 'gap-entered',
        cycle: cycle.cycleYear,
        affectedBoundaries,
        affectedStates: statesInGap.map(s => s.stateCode),
      });
    } else if (!isInGap && wasInGap) {
      // Just exited gap
      const affectedBoundaries: BoundaryType[] = [
        'congressional',
        'state_senate',
        'state_house',
      ];

      await this.emitEvent({
        type: 'gap-exited',
        cycle: cycle.cycleYear,
        tigerUpdated: true, // Assumption: gap exit means TIGER updated
        affectedBoundaries,
      });
    }
  }

  /**
   * Check for staleness warnings
   * Emits warnings when data approaches staleness threshold
   */
  async checkStalenessWarnings(asOf: Date = new Date()): Promise<void> {
    const boundaryTypes = authorityRegistry.getBoundaryTypes();

    for (const boundaryType of boundaryTypes) {
      const authority = authorityRegistry.getAuthority(boundaryType);

      for (const aggregator of authority.aggregatorSources) {
        // Calculate validity window for TIGER
        const lastRelease = this.getTigerReleaseDate(asOf);
        const window = validityWindowCalculator.calculateWindow(
          'tiger',
          lastRelease,
          boundaryType
        );

        const confidence = validityWindowCalculator.computeConfidence(window, asOf);

        // Emit warning if confidence is low
        if (confidence < 0.6 && confidence > 0) {
          const daysUntilStale = Math.floor(
            (window.validUntil.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24)
          );

          await this.emitEvent({
            type: 'staleness-warning',
            source: aggregator.name,
            boundaryType,
            daysUntilStale,
            confidence,
          });
        }
      }
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Generate unique webhook ID
   */
  private generateWebhookId(): string {
    return `webhook-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate unique polling ID
   */
  private generatePollingId(boundaryType: BoundaryType, jurisdiction?: string): string {
    return jurisdiction
      ? `poll-${boundaryType}-${jurisdiction}`
      : `poll-${boundaryType}`;
  }

  /**
   * Get source URL for boundary type and jurisdiction
   */
  private getSourceUrl(boundaryType: BoundaryType, jurisdiction?: string): string {
    if (jurisdiction) {
      // Get primary source URL
      const sources = authorityRegistry.getPrimarySourcesForState(jurisdiction);
      const source = sources.find(s =>
        'boundaryType' in s && s.jurisdiction === jurisdiction
      );
      return source?.url || '';
    }

    // Get TIGER URL
    const year = new Date().getFullYear();
    const authority = authorityRegistry.getAuthority(boundaryType);
    const aggregator = authority.aggregatorSources[0];

    if (!aggregator) {
      return '';
    }

    return aggregator.urlTemplate.replace('{YEAR}', year.toString());
  }

  /**
   * Get TIGER release date for a given year
   * TIGER releases in July annually
   */
  private getTigerReleaseDate(asOf: Date): Date {
    const year = asOf.getFullYear();
    return new Date(Date.UTC(year, 6, 1)); // July 1
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Default instance for convenient imports
 */
export const eventSubscriptionService = new EventSubscriptionService();

/**
 * Type guard for FreshnessEvent
 */
export function isFreshnessEvent(value: unknown): value is FreshnessEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const event = value as Partial<FreshnessEvent>;

  return (
    typeof event.type === 'string' &&
    (event.type === 'source-updated' ||
     event.type === 'gap-entered' ||
     event.type === 'gap-exited' ||
     event.type === 'staleness-warning')
  );
}

/**
 * Export types for external use
 */
export type {
  RSSFeed,
  RSSFeedEntry,
  WebhookSubscription,
  WebhookDeliveryResult,
  PollingConfig,
  PollingState,
};
