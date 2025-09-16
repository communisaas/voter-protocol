-- VOTER Protocol N8N Workflow Database Schema
-- Required tables for workflow execution and state management

-- Template verifications table
CREATE TABLE IF NOT EXISTS template_verifications (
  id SERIAL PRIMARY KEY,
  template_id VARCHAR(255) NOT NULL,
  approved BOOLEAN DEFAULT FALSE,
  severity INTEGER CHECK (severity >= 1 AND severity <= 10),
  decision VARCHAR(50) CHECK (decision IN ('approved', 'rejected', 'needs_review')),
  issues JSONB DEFAULT '[]',
  suggestions JSONB DEFAULT '{}',
  confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_template_id (template_id),
  INDEX idx_created_at (created_at)
);

-- Civic actions tracking
CREATE TABLE IF NOT EXISTS civic_actions (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  user_address VARCHAR(42),
  action_type VARCHAR(50) NOT NULL,
  template_id VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  tx_hash VARCHAR(66),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_action_type (action_type),
  INDEX idx_created_at (created_at)
);

-- Reputation registry (ERC-8004 compatible)
CREATE TABLE IF NOT EXISTS reputation_registry (
  id SERIAL PRIMARY KEY,
  user_address VARCHAR(42) UNIQUE NOT NULL,
  reputation_score INTEGER DEFAULT 0,
  actions_verified INTEGER DEFAULT 0,
  challenges_won INTEGER DEFAULT 0,
  challenges_lost INTEGER DEFAULT 0,
  violations INTEGER DEFAULT 0,
  tier VARCHAR(20) DEFAULT 'novice',
  last_action_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_address (user_address),
  INDEX idx_reputation_score (reputation_score)
);

-- Reward calculations
CREATE TABLE IF NOT EXISTS reward_calculations (
  id SERIAL PRIMARY KEY,
  user_address VARCHAR(42) NOT NULL,
  action_type VARCHAR(50) NOT NULL,
  base_reward_usd DECIMAL(10,4),
  total_multiplier DECIMAL(5,3),
  reward_usd DECIMAL(10,4),
  reward_wei VARCHAR(78),
  eth_price DECIMAL(10,2),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_address (user_address),
  INDEX idx_created_at (created_at)
);

-- Agent decisions log
CREATE TABLE IF NOT EXISTS agent_decisions (
  id SERIAL PRIMARY KEY,
  agent_type VARCHAR(50) NOT NULL,
  operation VARCHAR(50),
  input_data JSONB,
  decision JSONB NOT NULL,
  confidence DECIMAL(3,2),
  execution_time_ms INTEGER,
  workflow_id VARCHAR(255),
  execution_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent_type (agent_type),
  INDEX idx_workflow_id (workflow_id),
  INDEX idx_created_at (created_at)
);

-- Consensus voting results
CREATE TABLE IF NOT EXISTS consensus_results (
  id SERIAL PRIMARY KEY,
  template_id VARCHAR(255) NOT NULL,
  consensus VARCHAR(20) CHECK (consensus IN ('APPROVE', 'REJECT', 'NEEDS_REVIEW')),
  votes JSONB NOT NULL,
  agents_count INTEGER,
  average_confidence DECIMAL(3,2),
  unanimous BOOLEAN DEFAULT FALSE,
  reasons TEXT[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_template_id (template_id),
  INDEX idx_consensus (consensus)
);

-- Challenge market data
CREATE TABLE IF NOT EXISTS challenge_markets (
  id SERIAL PRIMARY KEY,
  claim_id VARCHAR(255) NOT NULL,
  challenger_address VARCHAR(42) NOT NULL,
  challenged_address VARCHAR(42) NOT NULL,
  stake_amount VARCHAR(78),
  status VARCHAR(20) DEFAULT 'open',
  resolution VARCHAR(20),
  winner_address VARCHAR(42),
  evidence JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  INDEX idx_claim_id (claim_id),
  INDEX idx_status (status)
);

-- Workflow execution metrics
CREATE TABLE IF NOT EXISTS workflow_metrics (
  id SERIAL PRIMARY KEY,
  workflow_name VARCHAR(100) NOT NULL,
  execution_id VARCHAR(255),
  success BOOLEAN,
  execution_time_ms INTEGER,
  error_message TEXT,
  input_size INTEGER,
  output_size INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_workflow_name (workflow_name),
  INDEX idx_created_at (created_at)
);

-- N8N chat memory for agent conversations
CREATE TABLE IF NOT EXISTS n8n_chat_memory (
  id SERIAL PRIMARY KEY,
  session_key VARCHAR(255) NOT NULL,
  message_id VARCHAR(255),
  sender VARCHAR(20) CHECK (sender IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_key (session_key),
  INDEX idx_created_at (created_at)
);

-- Create update trigger for reputation_registry
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_reputation_updated_at 
  BEFORE UPDATE ON reputation_registry
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions for N8N user (adjust username as needed)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO n8n_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO n8n_user;