# Frontend Integration Guide

## Overview

The VOTER Protocol backend provides REST APIs and WebSocket connections for the Communiqué frontend. This guide explains how to integrate the two codebases.

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│                 │   API   │                  │  Web3   │                 │
│   Communiqué    │◄────────►│  VOTER Protocol  │◄────────►│  Monad Chain   │
│   (Frontend)    │   WS    │    (Backend)     │         │   (Contracts)   │
│                 │         │                  │         │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
        │                            │
        └────────────┬───────────────┘
                     ▼
              [Shared Types]
```

## Setup Instructions

### 1. Install Shared Types

In your frontend repo:

```bash
# Option A: Link locally for development
cd /path/to/communique-frontend
npm link ../voter-protocol/shared

# Option B: Install from git
npm install git+https://github.com/your-org/voter-protocol.git#main
```

### 2. Environment Variables

Add to your frontend `.env`:

```env
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:8000  # Development
# NEXT_PUBLIC_API_URL=https://api.communi.email  # Production

NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws  # Development
# NEXT_PUBLIC_WS_URL=wss://api.communi.email/ws  # Production

# Chain Configuration
NEXT_PUBLIC_CHAIN_ID=1337  # Monad testnet
NEXT_PUBLIC_RPC_URL=https://testnet.monad.xyz

# Contract Addresses (from shared/types.ts)
NEXT_PUBLIC_VOTER_TOKEN_ADDRESS=0x0000000000000000000000000000000000000001
NEXT_PUBLIC_CHALLENGE_MARKET_ADDRESS=0x0000000000000000000000000000000000000005
```

### 3. API Client Setup

Create `lib/api-client.ts` in your frontend:

```typescript
import { 
  API_ENDPOINTS, 
  CivicAction, 
  CivicActionResult,
  APIResponse 
} from '@voter-protocol/shared/types';

class VoterProtocolAPI {
  private baseURL: string;
  private token?: string;

  constructor() {
    this.baseURL = API_ENDPOINTS.base;
  }

  setAuthToken(token: string) {
    this.token = token;
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<APIResponse<T>> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers,
    });

    return response.json();
  }

  // Process civic action
  async processCivicAction(action: CivicAction): Promise<CivicActionResult> {
    const response = await this.fetch<CivicActionResult>(
      API_ENDPOINTS.processAction,
      {
        method: 'POST',
        body: JSON.stringify(action),
      }
    );

    if (!response.success) {
      throw new Error(response.error);
    }

    return response.data!;
  }

  // Get user reputation
  async getReputation(address: string) {
    return this.fetch(API_ENDPOINTS.getReputation(address));
  }

  // Get token stats
  async getTokenStats() {
    return this.fetch(API_ENDPOINTS.tokenStats);
  }
}

export const apiClient = new VoterProtocolAPI();
```

### 4. WebSocket Integration

Create `lib/websocket.ts`:

```typescript
import { WSMessage, WSEventType } from '@voter-protocol/shared/types';

class VoterProtocolWS {
  private ws?: WebSocket;
  private listeners: Map<WSEventType, Set<(data: any) => void>> = new Map();

  connect() {
    this.ws = new WebSocket(API_ENDPOINTS.ws);

    this.ws.onmessage = (event) => {
      const message: WSMessage = JSON.parse(event.data);
      this.emit(message.type, message.payload);
    };

    this.ws.onopen = () => {
      console.log('Connected to VOTER Protocol');
    };
  }

  on(event: WSEventType, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  private emit(event: WSEventType, data: any) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }

  disconnect() {
    this.ws?.close();
  }
}

export const wsClient = new VoterProtocolWS();
```

### 5. React Hooks

Create `hooks/useVoterProtocol.ts`:

```typescript
import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { apiClient, wsClient } from '@/lib';
import { 
  CivicAction, 
  ReputationScore,
  TokenBalance 
} from '@voter-protocol/shared/types';

export function useVoterProtocol() {
  const { address } = useAccount();
  const [reputation, setReputation] = useState<ReputationScore>();
  const [balance, setBalance] = useState<TokenBalance>();

  useEffect(() => {
    if (address) {
      // Fetch initial data
      apiClient.getReputation(address).then(setReputation);
      
      // Subscribe to updates
      wsClient.on('REPUTATION_UPDATED', (data) => {
        if (data.address === address) {
          setReputation(data.reputation);
        }
      });
    }
  }, [address]);

  const submitAction = async (action: CivicAction) => {
    return apiClient.processCivicAction(action);
  };

  return {
    reputation,
    balance,
    submitAction,
  };
}
```

## Key Integration Points

### 1. Congressional Messages (CWC)

Frontend opens mail client → Backend processes verification:

```typescript
// Frontend
const handleCongressMessage = async (message: CongressionalMessage) => {
  // 1. Open mail client with pre-filled content
  const mailto = `mailto:${message.representative}@mail.house.gov?subject=${message.subject}&body=${message.message}`;
  window.open(mailto);
  
  // 2. Record action with backend
  const result = await apiClient.processCivicAction({
    actionType: ActionType.CWC_MESSAGE,
    userAddress: address,
    actionData: message,
    timestamp: new Date().toISOString()
  });
  
  // 3. Show reward notification
  toast.success(`Earned ${result.rewardAmount} VOTER tokens!`);
};
```

### 2. Challenge Markets

Frontend creates challenges → Backend handles staking:

```typescript
// Frontend
const createChallenge = async (claim: Challenge) => {
  // Approve token spending first
  await voterToken.approve(CHALLENGE_MARKET_ADDRESS, claim.stake);
  
  // Create challenge through API
  const result = await apiClient.createChallenge(claim);
  
  // Update UI with new challenge
  setChallenges(prev => [...prev, result.challenge]);
};
```

### 3. Reputation Display

Show credibility scores across the UI:

```typescript
// Component
function ReputationBadge({ address }: { address: string }) {
  const { reputation } = useReputation(address);
  
  return (
    <div className="reputation-badge">
      <span className={`tier-${reputation?.tier}`}>
        {reputation?.totalScore || 0}
      </span>
    </div>
  );
}
```

## Deployment

### Development

1. Run backend:
```bash
cd voter-protocol
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python api/server.py
```

2. Run frontend:
```bash
cd communique-frontend
npm install
npm run dev
```

### Production

1. Deploy contracts to Monad
2. Deploy backend API to cloud (AWS/GCP/Vercel)
3. Update frontend environment variables
4. Deploy frontend to Vercel/Netlify

### Docker Compose (Optional)

```yaml
version: '3.8'

services:
  backend:
    build: ./voter-protocol
    ports:
      - "8000:8000"
    environment:
      - MONAD_RPC_URL=${MONAD_RPC_URL}
      - DOMAIN=communi.email
    
  frontend:
    build: ./communique-frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://backend:8000
    depends_on:
      - backend
```

## API Authentication

The backend expects JWT tokens from the frontend:

```typescript
// Frontend auth flow
const authenticate = async (wallet: string, signature: string) => {
  const response = await fetch('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ wallet, signature })
  });
  
  const { token } = await response.json();
  apiClient.setAuthToken(token);
  localStorage.setItem('auth_token', token);
};
```

## Error Handling

Handle API errors gracefully:

```typescript
try {
  const result = await apiClient.processCivicAction(action);
} catch (error) {
  if (error.code === ErrorCode.RATE_LIMITED) {
    toast.error('Please wait before submitting another action');
  } else if (error.code === ErrorCode.INSUFFICIENT_BALANCE) {
    toast.error('Insufficient VOTER tokens');
  } else {
    toast.error('Something went wrong');
  }
}
```

## Testing Integration

Run integration tests:

```bash
# Backend tests
cd voter-protocol
pytest tests/

# Frontend tests
cd communique-frontend
npm run test:integration
```

## Support

- Backend issues: Create issue in voter-protocol repo
- Frontend issues: Create issue in communique repo
- Integration issues: Reference both repos in issue