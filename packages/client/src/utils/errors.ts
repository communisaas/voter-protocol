/**
 * Custom error types for VOTER Protocol client
 */

export class VOTERError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'VOTERError';
  }
}

export class ProofGenerationError extends VOTERError {
  constructor(message: string) {
    super(message, 'PROOF_GENERATION_ERROR');
    this.name = 'ProofGenerationError';
  }
}

export class ContractError extends VOTERError {
  constructor(message: string, public txHash?: string) {
    super(message, 'CONTRACT_ERROR');
    this.name = 'ContractError';
  }
}

export class NetworkError extends VOTERError {
  constructor(message: string, public statusCode?: number) {
    super(message, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}

export class AccountError extends VOTERError {
  constructor(message: string) {
    super(message, 'ACCOUNT_ERROR');
    this.name = 'AccountError';
  }
}
