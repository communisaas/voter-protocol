/**
 * NEAR Chain Signatures - MPC signing for cross-chain transactions
 * Enables NEAR implicit accounts to control Ethereum/Scroll addresses
 */

import { connect, Contract, Near } from 'near-api-js';
import { keccak256 } from 'ethers';
import type { NEARAccount } from './types';
import type { ChainSignatureRequest, ChainSignature } from './types';
import { AccountError } from '../utils/errors';
import { KeyStoreManager } from './keystore-manager';
import { hexToUint8 } from '../utils/encoding';

const MPC_CONTRACT_MAINNET = 'v1.signer';
const MPC_CONTRACT_TESTNET = 'v1.signer-dev.testnet';

export class ChainSignatureManager {
  private near: Near | null = null;
  private signerContract: Contract & any;
  private nearAccount: NEARAccount;
  private networkId: string;

  constructor(nearAccount: NEARAccount, networkId: string) {
    this.nearAccount = nearAccount;
    this.networkId = networkId;
    this.signerContract = null as any;
  }

  /**
   * Initialize NEAR connection and MPC signer contract
   */
  private async init(): Promise<void> {
    if (this.near) return; // Already initialized

    const config = {
      networkId: this.networkId,
      keyStore: KeyStoreManager.getKeyStore(), // ✅ Use shared keystore
      nodeUrl: this.networkId === 'mainnet'
        ? 'https://rpc.mainnet.near.org'
        : 'https://rpc.testnet.near.org',
    };

    this.near = await connect(config);

    // Connect to MPC signer contract
    const signerContractId = this.networkId === 'mainnet'
      ? MPC_CONTRACT_MAINNET
      : MPC_CONTRACT_TESTNET;

    const account = await this.near.account(this.nearAccount.accountId);

    this.signerContract = new Contract(
      account,
      signerContractId,
      {
        viewMethods: ['public_key', 'derived_public_key'],
        changeMethods: ['sign'],
        useLocalViewExecution: false
      }
    );
  }

  /**
   * Derive Scroll/Ethereum address from NEAR implicit account
   * Uses MPC to derive ECDSA public key → Ethereum address
   */
  async deriveScrollAddress(nearAccountId: string): Promise<string> {
    await this.init();

    try {
      // Request derived ECDSA public key from MPC contract
      const derivedKey = await this.signerContract.derived_public_key({
        predecessor: nearAccountId,
        path: 'scroll,1'  // Derivation path for Scroll
      });

      // Convert ECDSA public key to Ethereum address
      const address = this.publicKeyToAddress(derivedKey);
      return address;
    } catch (error) {
      if (error instanceof Error) {
        throw new AccountError(`Failed to derive Scroll address: ${error.message}`);
      }
      throw new AccountError('Failed to derive Scroll address');
    }
  }

  /**
   * Sign transaction via NEAR MPC (~2-3 seconds)
   * Returns ECDSA signature valid for Ethereum/Scroll
   */
  async signTransaction(request: ChainSignatureRequest): Promise<ChainSignature> {
    await this.init();

    try {
      // Call MPC signing contract
      const signature = await this.signerContract.sign({
        args: {
          payload: Array.from(request.payload),
          path: request.path,
          key_version: request.keyVersion
        },
        gas: '300000000000000',  // 300 TGas
      });

      return {
        r: signature.big_r,
        s: signature.s,
        v: signature.recovery_id,
        publicKey: signature.public_key
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new AccountError(`Transaction signing failed: ${error.message}`);
      }
      throw new AccountError('Transaction signing failed');
    }
  }

  /**
   * Convert ECDSA public key to Ethereum address
   * Address = keccak256(public_key)[12:32]
   */
  private publicKeyToAddress(publicKey: string): string {
    try {
      // Remove "04" prefix if present (uncompressed point indicator)
      const pubKeyHex = publicKey.startsWith('04')
        ? publicKey.slice(2)
        : publicKey;

      const pubKeyBytes = hexToUint8(pubKeyHex);

      // Keccak256 hash of public key
      const hash = keccak256(pubKeyBytes);

      // Take last 20 bytes (40 hex characters)
      return '0x' + hash.slice(-40);
    } catch (error) {
      throw new AccountError('Invalid public key format');
    }
  }

  /**
   * Derive Ethereum L1 address (for future use)
   */
  async deriveEthereumAddress(nearAccountId: string): Promise<string> {
    await this.init();

    const derivedKey = await this.signerContract.derived_public_key({
      predecessor: nearAccountId,
      path: 'ethereum,1'  // Different path for Ethereum L1
    });

    return this.publicKeyToAddress(derivedKey);
  }

  /**
   * Derive Bitcoin address (for future multi-chain expansion)
   */
  async deriveBitcoinAddress(nearAccountId: string): Promise<string> {
    await this.init();

    // Request derived key (not currently used but required for future implementation)
    await this.signerContract.derived_public_key({
      predecessor: nearAccountId,
      path: 'bitcoin,1'
    });

    // Bitcoin address derivation differs from Ethereum
    // TODO: Implement Bitcoin address derivation
    throw new Error('Bitcoin address derivation not yet implemented');
  }
}
