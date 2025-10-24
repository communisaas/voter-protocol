/**
 * ChainSignaturesSigner - ethers.js AbstractSigner implementation
 * Allows NEAR Chain Signatures to act as an Ethereum wallet
 *
 * This enables seamless integration with ethers.js contracts:
 * const signer = new ChainSignaturesSigner(nearAccount, provider);
 * const contract = new Contract(address, abi, signer);
 * await contract.someMethod(); // Signs with NEAR MPC (~2-3 seconds)
 */

import {
  AbstractSigner,
  type Provider,
  type TransactionRequest,
  type TransactionResponse
} from 'ethers';
import { ChainSignatureManager } from './chain-signatures';
import type { NEARAccount } from './types';
import { AccountError } from '../utils/errors';

export class ChainSignaturesSigner extends AbstractSigner {
  private chainSignatures: ChainSignatureManager;
  private nearAccount: NEARAccount;
  private scrollAddress: string | null = null;

  constructor(
    nearAccount: NEARAccount,
    provider: Provider,
    networkId: string = 'mainnet'
  ) {
    super(provider);
    this.nearAccount = nearAccount;
    this.chainSignatures = new ChainSignatureManager(nearAccount, networkId);
  }

  /**
   * Get Ethereum address controlled by this NEAR account
   * Lazy loads on first call
   */
  async getAddress(): Promise<string> {
    if (this.scrollAddress) {
      return this.scrollAddress;
    }

    // Derive Scroll/Ethereum address via MPC
    this.scrollAddress = await this.chainSignatures.deriveScrollAddress(
      this.nearAccount.accountId
    );

    return this.scrollAddress;
  }

  /**
   * Sign transaction using NEAR Chain Signatures MPC
   * This is where the magic happens: NEAR validators sign Ethereum transactions
   */
  async signTransaction(transaction: TransactionRequest): Promise<string> {
    try {
      // Get provider for transaction serialization
      const provider = this.provider;
      if (!provider) {
        throw new AccountError('Provider required for transaction signing');
      }

      // Populate transaction fields (nonce, gas price, etc.)
      const populatedTx = await this.populateTransaction(transaction);

      // Serialize transaction for signing
      const serializedTx = await provider.getNetwork().then(async (network) => {
        // Convert TransactionRequest to proper format for signing
        const txData = {
          to: populatedTx.to || undefined,
          data: populatedTx.data || '0x',
          value: populatedTx.value || 0n,
          gasLimit: populatedTx.gasLimit || 0n,
          gasPrice: populatedTx.gasPrice || 0n,
          nonce: populatedTx.nonce || 0,
          chainId: network.chainId
        };

        // Note: Full implementation requires proper serialization
        // This is a simplified version for demonstration
        return JSON.stringify(txData);
      });

      // Sign via NEAR MPC (~2-3 seconds)
      const signature = await this.chainSignatures.signTransaction({
        payload: new TextEncoder().encode(serializedTx),
        path: 'scroll,1', // Derivation path
        keyVersion: 0
      });

      // Convert MPC signature to Ethereum format
      const r = signature.r;
      const s = signature.s;
      const v = signature.v;

      // Reconstruct signed transaction
      // Note: Full implementation requires proper transaction serialization
      return `0x${r}${s}${v.toString(16)}`;
    } catch (error) {
      if (error instanceof Error) {
        throw new AccountError(`Transaction signing failed: ${error.message}`);
      }
      throw new AccountError('Transaction signing failed');
    }
  }

  /**
   * Sign message using NEAR Chain Signatures
   * Useful for off-chain signatures (EIP-712, etc.)
   */
  async signMessage(message: string | Uint8Array): Promise<string> {
    try {
      const messageBytes = typeof message === 'string'
        ? new TextEncoder().encode(message)
        : message;

      const signature = await this.chainSignatures.signTransaction({
        payload: messageBytes,
        path: 'scroll,1',
        keyVersion: 0
      });

      // Convert to Ethereum signature format
      const r = signature.r.padStart(64, '0');
      const s = signature.s.padStart(64, '0');
      const v = signature.v.toString(16).padStart(2, '0');

      return `0x${r}${s}${v}`;
    } catch (error) {
      if (error instanceof Error) {
        throw new AccountError(`Message signing failed: ${error.message}`);
      }
      throw new AccountError('Message signing failed');
    }
  }

  /**
   * Sign typed data (EIP-712)
   * Used for structured messages (permit, voting, etc.)
   */
  async signTypedData(
    domain: any,
    types: any,
    value: any
  ): Promise<string> {
    // For now, convert to string and sign
    // Full implementation requires EIP-712 encoding
    const message = JSON.stringify({ domain, types, value });
    return this.signMessage(message);
  }

  /**
   * Connect to new provider
   */
  connect(provider: Provider): ChainSignaturesSigner {
    return new ChainSignaturesSigner(
      this.nearAccount,
      provider,
      this.chainSignatures['networkId'] // Access private field
    );
  }

  /**
   * Send transaction (sign + broadcast)
   */
  async sendTransaction(
    transaction: TransactionRequest
  ): Promise<TransactionResponse> {
    const provider = this.provider;
    if (!provider) {
      throw new AccountError('Provider required to send transaction');
    }

    // Sign transaction
    const signedTx = await this.signTransaction(transaction);

    // Broadcast to network
    return await provider.broadcastTransaction(signedTx);
  }
}
