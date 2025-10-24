/**
 * NEAR implicit account creation and management
 * FREE - no on-chain transaction required
 */

import { KeyPair, keyStores } from 'near-api-js';
import { createKey, getKeys } from '@near-js/biometric-ed25519';
import * as sha256Module from 'js-sha256';
import type { NEARAccount, NEARAccountOptions } from './types';
import { AccountError } from '../utils/errors';
import { KeyStoreManager } from './keystore-manager';

export class NEARAccountManager {
  private keyStore: InstanceType<typeof keyStores.InMemoryKeyStore>;
  private networkId: string;

  constructor(networkId: string) {
    // Use shared keystore so Chain Signatures can access keys
    this.keyStore = KeyStoreManager.getKeyStore();
    this.networkId = networkId;
  }

  /**
   * Create implicit NEAR account
   * FREE - no on-chain transaction, instant creation
   */
  async createImplicitAccount(options: NEARAccountOptions): Promise<NEARAccount> {
    let keyPair: KeyPair;

    if (options.method === 'passkey') {
      keyPair = await this.createPasskeyKeyPair();
    } else {
      // Generate from random seed (fallback)
      keyPair = KeyPair.fromRandom('ed25519');
    }

    // Derive implicit account ID from public key
    // Implicit accounts are deterministic: SHA256(public_key) = account_id
    const publicKey = keyPair.getPublicKey().data;
    const sha256Fn = (sha256Module as any).sha256 || sha256Module;
    const accountId = sha256Fn(publicKey);

    // Store in browser (IndexedDB via NEAR's keyStore)
    await this.keyStore.setKey(options.networkId, accountId, keyPair);

    return {
      accountId,
      keyPair,
      publicKey: keyPair.getPublicKey().toString()
    };
  }

  /**
   * Create Ed25519 keypair from WebAuthn passkey
   * Uses NEAR's official biometric library with Face ID / Touch ID
   */
  private async createPasskeyKeyPair(): Promise<KeyPair> {
    if (!window.navigator.credentials) {
      throw new AccountError('WebAuthn not supported in this browser');
    }

    try {
      // Generate unique username for this passkey
      const userName = `voter-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      // Use NEAR's official biometric signer
      // This properly generates Ed25519 keypair with BOTH public and private keys
      const keyPair = await createKey(userName);

      // Store username for future retrieval
      localStorage.setItem('voter_passkey_username', userName);

      // Store public key to identify correct keypair on retrieval
      // (getKeys returns 2 possible pairs due to EC crypto)
      localStorage.setItem('voter_passkey_public_key', keyPair.getPublicKey().toString());

      return keyPair;
    } catch (error) {
      if (error instanceof Error) {
        throw new AccountError(`Passkey creation failed: ${error.message}`);
      }
      throw new AccountError('Passkey creation failed');
    }
  }

  /**
   * Retrieve passkey KeyPair from browser storage
   * Used when user returns to app and needs to sign transactions
   */
  async retrievePasskeyKeyPair(): Promise<KeyPair | null> {
    const userName = localStorage.getItem('voter_passkey_username');
    const storedPublicKey = localStorage.getItem('voter_passkey_public_key');

    if (!userName || !storedPublicKey) {
      return null;
    }

    try {
      // getKeys returns 2 possible keypairs due to elliptic curve cryptography
      const keyPairs = await getKeys(userName);

      // Find the correct keypair by matching stored public key
      for (const keyPair of keyPairs) {
        if (keyPair.getPublicKey().toString() === storedPublicKey) {
          return keyPair;
        }
      }

      throw new AccountError('Passkey public key mismatch - stored key not found');
    } catch (error) {
      if (error instanceof Error) {
        throw new AccountError(`Passkey retrieval failed: ${error.message}`);
      }
      throw new AccountError('Passkey retrieval failed');
    }
  }

  /**
   * Retrieve existing account from keyStore
   */
  async getAccount(accountId: string): Promise<NEARAccount | null> {
    try {
      const keyPair = await this.keyStore.getKey(this.networkId, accountId);

      if (!keyPair) return null;

      return {
        accountId,
        keyPair,
        publicKey: keyPair.getPublicKey().toString()
      };
    } catch {
      return null;
    }
  }

  /**
   * List all stored accounts
   */
  async listAccounts(): Promise<string[]> {
    return this.keyStore.getAccounts(this.networkId);
  }

  /**
   * Remove account from keyStore
   */
  async removeAccount(accountId: string): Promise<void> {
    await this.keyStore.removeKey(this.networkId, accountId);
  }
}
