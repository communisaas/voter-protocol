/**
 * Singleton KeyStore manager
 * Ensures all NEAR components (NEARAccountManager, ChainSignatureManager)
 * share the same keystore so keys are accessible across the SDK
 */

import { keyStores } from 'near-api-js';

/**
 * Singleton keystore shared across all NEAR components
 * This is critical for Chain Signatures to access keys created by NEARAccountManager
 */
class KeyStoreManager {
  private static instance: InstanceType<typeof keyStores.InMemoryKeyStore> | null = null;

  /**
   * Get shared keystore instance
   * All components must use this to ensure key accessibility
   */
  static getKeyStore(): InstanceType<typeof keyStores.InMemoryKeyStore> {
    if (!KeyStoreManager.instance) {
      KeyStoreManager.instance = new keyStores.InMemoryKeyStore();
    }
    return KeyStoreManager.instance;
  }

  /**
   * Reset keystore (useful for testing or logout)
   */
  static resetKeyStore(): void {
    KeyStoreManager.instance = new keyStores.InMemoryKeyStore();
  }

  /**
   * Check if keystore has been initialized
   */
  static isInitialized(): boolean {
    return KeyStoreManager.instance !== null;
  }
}

export { KeyStoreManager };
