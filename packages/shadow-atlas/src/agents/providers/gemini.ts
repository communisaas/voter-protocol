/**
 * Gemini API Provider
 *
 * Unified interface for Google Gemini models with:
 * - Key rotation across multiple projects
 * - Exponential backoff with jitter
 * - Model selection based on task type
 * - Cost tracking
 */

import { KeyRotator, RateLimitError, AllKeysExhaustedError } from '../rate-limiting/key-rotator.js';

/**
 * Supported Gemini models
 */
export type GeminiModel =
  | 'gemini-2.5-flash'
  | 'gemini-2.5-flash-lite'
  | 'gemini-2.5-pro'
  | 'gemini-2.0-flash';

/**
 * Task types for automatic model selection
 */
export type TaskType =
  | 'url_validation'       // Simple binary check
  | 'governance_classify'  // Classify ward vs at-large
  | 'source_research'      // Complex web research
  | 'data_extraction'      // Parse GIS metadata
  | 'general';             // Default

/**
 * Pricing per 1M tokens (November 2025)
 */
const MODEL_PRICING: Record<GeminiModel, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
};

/**
 * Model selection based on task type
 */
const TASK_MODEL_MAP: Record<TaskType, GeminiModel> = {
  url_validation: 'gemini-2.5-flash-lite',
  governance_classify: 'gemini-2.5-flash',
  source_research: 'gemini-2.5-pro',
  data_extraction: 'gemini-2.5-flash',
  general: 'gemini-2.5-flash-lite',
};

/**
 * Retry configuration
 */
interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  jitterFactor: 0.2,
};

/**
 * Generation request
 */
export interface GenerationRequest {
  prompt: string;
  systemPrompt?: string;
  model?: GeminiModel;
  taskType?: TaskType;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Generation response
 */
export interface GenerationResponse {
  text: string;
  model: GeminiModel;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  latencyMs: number;
}

/**
 * Gemini API client with key rotation
 */
export class GeminiClient {
  private keyRotator: KeyRotator;
  private retryConfig: RetryConfig;
  private totalCost: number = 0;
  private totalRequests: number = 0;

  constructor(keyRotator: KeyRotator, retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG) {
    this.keyRotator = keyRotator;
    this.retryConfig = retryConfig;
  }

  /**
   * Generate text with automatic model selection and retry
   */
  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    const model = request.model ?? TASK_MODEL_MAP[request.taskType ?? 'general'];
    const maxTokens = request.maxTokens ?? 1000;
    const temperature = request.temperature ?? 0.7;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      let currentKey: string | null = null;

      try {
        // Get next available key
        const { key, projectId } = this.keyRotator.getNextKey();
        currentKey = key;

        const startTime = Date.now();

        // Make API request
        const response = await this.callGeminiAPI({
          key,
          model,
          prompt: request.prompt,
          systemPrompt: request.systemPrompt,
          maxTokens,
          temperature,
        });

        const latencyMs = Date.now() - startTime;

        // Mark success
        this.keyRotator.markSuccess(key);
        this.totalRequests++;

        // Calculate cost
        const pricing = MODEL_PRICING[model];
        const estimatedCost =
          (response.inputTokens / 1_000_000) * pricing.input +
          (response.outputTokens / 1_000_000) * pricing.output;
        this.totalCost += estimatedCost;

        return {
          text: response.text,
          model,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          estimatedCost,
          latencyMs,
        };
      } catch (error) {
        lastError = error as Error;

        // Check if rate limited
        if (this.isRateLimitError(error)) {
          if (currentKey) {
            const retryAfter = this.extractRetryAfter(error) ?? 60000;
            this.keyRotator.markRateLimited(currentKey, retryAfter);
          }

          // Don't count as attempt if we can try another key
          if (attempt < this.retryConfig.maxAttempts - 1) {
            continue;
          }
        }

        // Check if should retry
        if (!this.shouldRetry(error) || attempt === this.retryConfig.maxAttempts - 1) {
          throw error;
        }

        // Calculate backoff delay with jitter
        const baseDelay = Math.min(
          this.retryConfig.baseDelayMs * Math.pow(2, attempt),
          this.retryConfig.maxDelayMs
        );
        const jitter = baseDelay * this.retryConfig.jitterFactor * Math.random();
        const delay = baseDelay + jitter;

        console.warn(
          `[GeminiClient] Retry ${attempt + 1}/${this.retryConfig.maxAttempts} ` +
          `in ${Math.round(delay)}ms: ${(error as Error).message}`
        );

        await this.sleep(delay);
      }
    }

    throw lastError ?? new Error('Unknown error after retries');
  }

  /**
   * Generate with automatic model selection based on task
   */
  async generateForTask(
    taskType: TaskType,
    prompt: string,
    systemPrompt?: string
  ): Promise<GenerationResponse> {
    return this.generate({
      prompt,
      systemPrompt,
      taskType,
    });
  }

  /**
   * Get usage statistics
   */
  getStats(): {
    totalRequests: number;
    totalCost: number;
    keyStatus: ReturnType<KeyRotator['getStatus']>;
  } {
    return {
      totalRequests: this.totalRequests,
      totalCost: this.totalCost,
      keyStatus: this.keyRotator.getStatus(),
    };
  }

  /**
   * Call Gemini API directly
   */
  private async callGeminiAPI(params: {
    key: string;
    model: GeminiModel;
    prompt: string;
    systemPrompt?: string;
    maxTokens: number;
    temperature: number;
  }): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${params.key}`;

    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    // Add system instruction if provided
    const systemInstruction = params.systemPrompt
      ? { parts: [{ text: params.systemPrompt }] }
      : undefined;

    // Add user message
    contents.push({
      role: 'user',
      parts: [{ text: params.prompt }],
    });

    const body = {
      contents,
      systemInstruction,
      generationConfig: {
        maxOutputTokens: params.maxTokens,
        temperature: params.temperature,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000), // 2 minute timeout
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const error = new Error(`Gemini API error: ${response.status} ${errorBody}`);
      (error as GeminiAPIError).status = response.status;
      (error as GeminiAPIError).body = errorBody;
      throw error;
    }

    const data = await response.json();

    // Extract response text
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    // Extract token counts
    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

    return { text, inputTokens, outputTokens };
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof AllKeysExhaustedError) {
      return true;
    }

    const apiError = error as GeminiAPIError;
    if (apiError.status === 429) {
      return true;
    }

    const message = (error as Error).message?.toLowerCase() ?? '';
    return (
      message.includes('resource_exhausted') ||
      message.includes('quota') ||
      message.includes('rate limit') ||
      message.includes('too many requests')
    );
  }

  /**
   * Extract retry-after from error response
   */
  private extractRetryAfter(error: unknown): number | null {
    const apiError = error as GeminiAPIError;
    if (apiError.body) {
      try {
        const parsed = JSON.parse(apiError.body);
        // Google sometimes includes retry info
        const retryAfter = parsed.error?.details?.find(
          (d: Record<string, unknown>) => d.retryInfo
        )?.retryInfo?.retryDelay;
        if (retryAfter) {
          // Parse "60s" format
          const match = retryAfter.match(/(\d+)s/);
          if (match) {
            return parseInt(match[1], 10) * 1000;
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
    return null;
  }

  /**
   * Check if error is retryable
   */
  private shouldRetry(error: unknown): boolean {
    const apiError = error as GeminiAPIError;
    const status = apiError.status;

    // Retry on rate limit, server errors, timeout
    if (status === 429 || status === 503 || status === 500) {
      return true;
    }

    const message = (error as Error).message?.toLowerCase() ?? '';
    return (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('unavailable') ||
      message.includes('internal')
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

interface GeminiAPIError extends Error {
  status?: number;
  body?: string;
}

/**
 * Create Gemini client from environment
 */
export function createGeminiClient(keyRotator: KeyRotator): GeminiClient {
  return new GeminiClient(keyRotator);
}
