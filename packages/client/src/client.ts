/**
 * Main VOTER Protocol client
 *
 * Coordinates account management, zero-knowledge proofs, and smart contract interactions
 */

import { ethers } from 'ethers';
import { NEARAccountManager } from './account/near-account';
import { ChainSignatureManager } from './account/chain-signatures';
import { ChainSignaturesSigner } from './account/chain-signatures-signer';
import { Halo2Prover } from './zk/halo2-prover';
import { ShadowAtlas } from './zk/shadow-atlas';
import { DistrictGateContract } from './contracts/district-gate';
import { ReputationRegistryContract } from './contracts/reputation-registry';
import type { NEARAccount } from './account/types';
import type { DistrictProof } from './zk/types';
import type { StreetAddress } from './utils/addresses';
import { createStreetAddress } from './utils/addresses';

export interface VOTERClientConfig {
  // Network configuration
  network: 'scroll-sepolia' | 'scroll-mainnet';
  nearNetwork?: 'mainnet' | 'testnet';

  // Contract addresses (required)
  districtGateAddress: string;
  reputationRegistryAddress: string;

  // Optional: existing wallet connection (must be defined if provided)
  walletProvider?: ethers.Eip1193Provider | undefined;
  skipNEAR?: boolean;

  // Shadow Atlas source (IPFS gateway OR local URL for development)
  // Examples:
  //   - 'https://gateway.pinata.cloud/ipfs' (production IPFS)
  //   - 'http://localhost:8080/atlas' (local development)
  shadowAtlasUrl?: string;

  // Deprecated: use shadowAtlasUrl instead
  ipfsGateway?: string;

  // Cache strategy
  cacheStrategy?: 'aggressive' | 'moderate' | 'minimal';
}

export interface VOTERClientState {
  initialized: boolean;
  nearAccount: NEARAccount | null;
  scrollAddress: string | null;
  connectedWallet: string | null;
}

const DEFAULT_IPFS_GATEWAY = 'https://gateway.voter.network/ipfs';

const SCROLL_NETWORKS = {
  'scroll-sepolia': {
    chainId: 534351,
    rpcUrl: 'https://sepolia-rpc.scroll.io'
  },
  'scroll-mainnet': {
    chainId: 534352,
    rpcUrl: 'https://rpc.scroll.io'
  }
} as const;

export class VOTERClient {
  private config: Required<Omit<VOTERClientConfig, 'walletProvider'>> & { walletProvider?: ethers.Eip1193Provider };
  private state: VOTERClientState;
  private initPromise: Promise<void> | null = null;

  // Account management
  private nearAccountManager: NEARAccountManager | null = null;
  private chainSignatures: ChainSignatureManager | null = null;

  // ZK proof generation
  private halo2Prover: Halo2Prover | null = null;
  private shadowAtlas: ShadowAtlas | null = null;

  // Blockchain interaction
  private scrollProvider: ethers.JsonRpcProvider;
  private districtGateContract: DistrictGateContract | null = null;
  private reputationRegistryContract: ReputationRegistryContract | null = null;

  constructor(config: VOTERClientConfig) {
    // Support both shadowAtlasUrl (new) and ipfsGateway (deprecated)
    const atlasUrl = config.shadowAtlasUrl || config.ipfsGateway || DEFAULT_IPFS_GATEWAY;

    this.config = {
      nearNetwork: 'mainnet',
      shadowAtlasUrl: atlasUrl,
      ipfsGateway: atlasUrl, // Keep for backward compatibility
      cacheStrategy: 'aggressive',
      skipNEAR: false,
      ...config,
      walletProvider: config.walletProvider
    };

    this.state = {
      initialized: false,
      nearAccount: null,
      scrollAddress: null,
      connectedWallet: null
    };

    // Initialize Scroll provider
    const networkConfig = SCROLL_NETWORKS[config.network];
    this.scrollProvider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

    // Start async initialization (don't block constructor)
    this.initPromise = this.initZKComponents();
  }

  /**
   * Wait for client to be fully initialized
   * MUST be called before using zk or contracts APIs
   * Can be called multiple times (idempotent)
   */
  async ready(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
  }

  /**
   * Check if client is ready (synchronous)
   */
  isReady(): boolean {
    return this.state.initialized;
  }

  /**
   * Initialize ZK components (async)
   */
  private async initZKComponents(): Promise<void> {
    // Initialize Halo2 prover
    this.halo2Prover = new Halo2Prover();
    await this.halo2Prover.init();

    // Initialize Shadow Atlas
    this.shadowAtlas = new ShadowAtlas(
      this.config.ipfsGateway,
      this.config.cacheStrategy === 'minimal' ? 'minimal' : 'aggressive'
    );

    // Initialize contracts
    this.districtGateContract = new DistrictGateContract(
      { address: this.config.districtGateAddress, verifierAddress: '0x' },
      this.scrollProvider
    );

    this.reputationRegistryContract = new ReputationRegistryContract(
      this.config.reputationRegistryAddress,
      this.scrollProvider
    );

    this.state.initialized = true;
  }

  /**
   * Account Management API
   */
  get account() {
    return {
      /**
       * Create NEAR implicit account (passkey-based)
       */
      create: async (options: { method: 'passkey' | 'seed' }) => {
        if (this.config.skipNEAR) {
          throw new Error('NEAR account creation disabled (skipNEAR: true)');
        }

        if (!this.nearAccountManager) {
          this.nearAccountManager = new NEARAccountManager(this.config.nearNetwork);
        }

        const nearAccount = await this.nearAccountManager.createImplicitAccount({
          method: options.method,
          networkId: this.config.nearNetwork
        });

        this.state.nearAccount = nearAccount;

        // Derive Scroll address via Chain Signatures
        if (!this.chainSignatures) {
          this.chainSignatures = new ChainSignatureManager(
            nearAccount,
            this.config.nearNetwork
          );
        }

        const scrollAddress = await this.chainSignatures.deriveScrollAddress(
          nearAccount.accountId
        );

        this.state.scrollAddress = scrollAddress;

        return {
          nearAccount: nearAccount.accountId,
          scrollAddress,
          ethAddress: scrollAddress // Same for now
        };
      },

      /**
       * Get current account state
       */
      getState: () => ({
        nearAccount: this.state.nearAccount?.accountId || null,
        scrollAddress: this.state.scrollAddress,
        connectedWallet: this.state.connectedWallet
      })
    };
  }

  /**
   * Zero-Knowledge Proof API
   */
  get zk() {
    return {
      /**
       * Generate district membership proof
       * @param params.address - Full street address (e.g., "123 Main St, Springfield, IL 62701")
       */
      proveDistrict: async (params: { address: string | StreetAddress }): Promise<DistrictProof> => {
        // Auto-wait for initialization
        await this.ready();

        if (!this.halo2Prover || !this.shadowAtlas || !this.districtGateContract) {
          throw new Error('Client components failed to initialize');
        }

        // Validate and convert to StreetAddress type
        const streetAddress = typeof params.address === 'string'
          ? createStreetAddress(params.address)
          : params.address;

        // 1. Get current on-chain Merkle root
        const onChainRoot = await this.districtGateContract.getCurrentMerkleRoot();

        // 2. Get current Shadow Atlas CID from contract
        const cid = await this.districtGateContract.getShadowAtlasCID();

        // 3. Load Shadow Atlas and verify against on-chain root
        // This prevents wasting 8-12 seconds on proofs that will fail on-chain
        await this.shadowAtlas.load(cid, onChainRoot);

        // 4. Generate Merkle proof from Shadow Atlas
        const merkleProof = await this.shadowAtlas.generateProof(streetAddress);

        // 5. Generate Halo2 zero-knowledge proof
        const proof = await this.halo2Prover.prove({
          address: streetAddress,
          merkleProof
        });

        return proof;
      },

      /**
       * Verify proof locally (for testing)
       */
      verifyProof: async (proof: DistrictProof): Promise<boolean> => {
        await this.ready();

        if (!this.halo2Prover) {
          throw new Error('Client components failed to initialize');
        }

        return this.halo2Prover.verify(proof);
      },

      /**
       * Shadow Atlas access
       */
      shadowAtlas: this.shadowAtlas,

      /**
       * Halo2 prover access
       */
      halo2Prover: this.halo2Prover
    };
  }

  /**
   * Smart Contract Interaction API
   */
  get contracts() {
    const self = this;
    return {
      /**
       * DistrictGate contract (district verification)
       */
      get districtGate() {
        if (!self.districtGateContract) {
          throw new Error('Client not initialized');
        }
        return self.districtGateContract;
      },

      /**
       * ReputationRegistry contract (ERC-8004)
       */
      get reputationRegistry() {
        if (!self.reputationRegistryContract) {
          throw new Error('Client not initialized');
        }
        return self.reputationRegistryContract;
      }
    };
  }

  /**
   * Get current network
   */
  getNetwork(): string {
    return this.config.network;
  }

  /**
   * Get current client state
   */
  getState(): VOTERClientState {
    return { ...this.state };
  }

  /**
   * Connect external wallet signer (MetaMask, WalletConnect, etc.)
   * This replaces the default read-only provider with a signer that can send transactions
   */
  connectSigner(signer: ethers.Signer): void {
    if (!this.districtGateContract || !this.reputationRegistryContract) {
      throw new Error('Client not initialized - call ready() first');
    }

    // Recreate contracts with signer instead of provider
    this.districtGateContract = new DistrictGateContract(
      { address: this.config.districtGateAddress, verifierAddress: '0x' },
      signer
    );

    this.reputationRegistryContract = new ReputationRegistryContract(
      this.config.reputationRegistryAddress,
      signer
    );
  }

  /**
   * Create ChainSignaturesSigner from current NEAR account
   * Allows NEAR accounts to sign Ethereum transactions via MPC
   *
   * @example
   * const client = new VOTERClient(config);
   * await client.account.create({ method: 'passkey' });
   * const signer = client.useChainSignaturesSigner();
   * client.connectSigner(signer); // Now contracts use NEAR MPC for signing
   */
  useChainSignaturesSigner(): ChainSignaturesSigner {
    if (!this.state.nearAccount) {
      throw new Error('No NEAR account - call account.create() first');
    }

    return new ChainSignaturesSigner(
      this.state.nearAccount,
      this.scrollProvider,
      this.config.nearNetwork
    );
  }
}
