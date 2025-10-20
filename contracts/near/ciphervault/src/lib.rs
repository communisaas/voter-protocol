use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{UnorderedMap, LookupMap};
use near_sdk::{env, near_bindgen, AccountId, PanicOnDefault, Balance};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::json_types::U128;

/// Maximum envelope size (100KB) to prevent storage cost attacks
const MAX_ENVELOPE_SIZE: usize = 100_000;

/// Storage cost per byte (1E19 yoctoNEAR = 0.00001 NEAR per byte)
const STORAGE_COST_PER_BYTE: u128 = 10_000_000_000_000_000_000;

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct CipherEnvelope {
    pub owner: AccountId,
    pub encrypted_data: Vec<u8>,
    pub nonce: Vec<u8>,
    pub poseidon_commit: String,
    pub encrypted_sovereign_key: Vec<u8>,
    pub sovereign_key_iv: Vec<u8>,        // NEW: AES-GCM IV (12 bytes)
    pub sovereign_key_tag: Vec<u8>,       // NEW: AES-GCM auth tag (16 bytes)
    pub version: u32,
    pub created_at: u64,
    pub guardians: Vec<AccountId>,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct StorageBalanceBounds {
    pub min: U128,
    pub max: Option<U128>,
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct CipherVault {
    envelopes: UnorderedMap<String, CipherEnvelope>,
    envelope_counter: u64,
    storage_balances: LookupMap<AccountId, Balance>,  // NEW: Storage deposit tracking
}

#[near_bindgen]
impl CipherVault {
    #[init]
    pub fn new() -> Self {
        Self {
            envelopes: UnorderedMap::new(b"e"),
            envelope_counter: 0,
            storage_balances: LookupMap::new(b"s"),
        }
    }

    /// Storage deposit - users must deposit NEAR to cover storage costs
    /// Implements NEP-145 storage management standard
    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        let amount = env::attached_deposit();
        let account = account_id.unwrap_or_else(env::predecessor_account_id);

        assert!(amount > 0, "Deposit amount must be greater than 0");

        let current_balance = self.storage_balances.get(&account).unwrap_or(0);
        let new_balance = current_balance + amount;

        self.storage_balances.insert(&account, &new_balance);

        StorageBalance {
            total: U128(new_balance),
            available: U128(new_balance),
        }
    }

    /// Check storage balance for an account
    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.storage_balances.get(&account_id).map(|balance| StorageBalance {
            total: U128(balance),
            available: U128(balance),
        })
    }

    /// Get minimum and maximum storage balance bounds
    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        // Minimum: 5KB typical envelope
        const MIN_ENVELOPE_SIZE: u64 = 5120; // 5KB in bytes
        let min_balance = (MIN_ENVELOPE_SIZE as u128) * STORAGE_COST_PER_BYTE;

        StorageBalanceBounds {
            min: U128(min_balance),
            max: None, // No hard maximum
        }
    }

    /// Calculate storage cost for given data size
    fn calculate_storage_cost(&self, envelope: &CipherEnvelope) -> u128 {
        let total_size = envelope.encrypted_data.len()
            + envelope.nonce.len()
            + envelope.poseidon_commit.len()
            + envelope.encrypted_sovereign_key.len()
            + envelope.sovereign_key_iv.len()
            + envelope.sovereign_key_tag.len()
            + 200; // Overhead for struct fields, AccountId, etc.

        (total_size as u128) * STORAGE_COST_PER_BYTE
    }

    /// Store encrypted PII envelope
    /// Returns envelope_id for PostgreSQL reference
    ///
    /// SECURITY NOTES:
    /// - Requires prior storage_deposit() to cover storage costs
    /// - Enforces 100KB maximum envelope size
    /// - Validates all cryptographic parameters
    pub fn store_envelope(
        &mut self,
        encrypted_data: Vec<u8>,
        nonce: Vec<u8>,
        poseidon_commit: String,
        encrypted_sovereign_key: Vec<u8>,
        sovereign_key_iv: Vec<u8>,
        sovereign_key_tag: Vec<u8>,
        guardians: Option<Vec<AccountId>>,
    ) -> String {
        let account = env::predecessor_account_id();

        // Validate inputs
        assert!(!encrypted_data.is_empty(), "Encrypted data cannot be empty");
        assert_eq!(nonce.len(), 24, "Nonce must be 24 bytes (XChaCha20)");
        assert_eq!(poseidon_commit.len(), 64, "Poseidon commitment must be 32 bytes (64 hex chars)");
        assert_eq!(sovereign_key_iv.len(), 12, "AES-GCM IV must be 12 bytes");
        assert_eq!(sovereign_key_tag.len(), 16, "AES-GCM auth tag must be 16 bytes");

        // Enforce size limits to prevent storage cost attacks
        assert!(
            encrypted_data.len() <= MAX_ENVELOPE_SIZE,
            "Encrypted data exceeds maximum size (100KB)"
        );

        // Create envelope
        let envelope = CipherEnvelope {
            owner: account.clone(),
            encrypted_data,
            nonce,
            poseidon_commit,
            encrypted_sovereign_key,
            sovereign_key_iv,
            sovereign_key_tag,
            version: 1,
            created_at: env::block_timestamp(),
            guardians: guardians.unwrap_or_default(),
        };

        // Calculate storage cost
        let storage_cost = self.calculate_storage_cost(&envelope);

        // Check user's storage balance
        let current_balance = self.storage_balances.get(&account).unwrap_or(0);
        assert!(
            current_balance >= storage_cost,
            "Insufficient storage deposit. Required: {} yoctoNEAR, Available: {} yoctoNEAR. Call storage_deposit() first.",
            storage_cost,
            current_balance
        );

        // Deduct storage cost from user's balance
        let new_balance = current_balance - storage_cost;
        self.storage_balances.insert(&account, &new_balance);

        // Generate envelope ID and store
        self.envelope_counter += 1;
        let envelope_id = format!("{}-{}", account, self.envelope_counter);
        self.envelopes.insert(&envelope_id, &envelope);

        envelope_id
    }

    /// Retrieve envelope by ID
    ///
    /// SECURITY NOTE: This is a view call - anyone can retrieve any envelope.
    /// Privacy is guaranteed by client-side encryption, not access control.
    /// Only users with the sovereign key can decrypt the PII.
    pub fn get_envelope(&self, envelope_id: String) -> Option<CipherEnvelope> {
        self.envelopes.get(&envelope_id)
    }

    /// Update envelope (creates new version)
    pub fn update_envelope(
        &mut self,
        envelope_id: String,
        encrypted_data: Vec<u8>,
        nonce: Vec<u8>,
        poseidon_commit: String,
        encrypted_sovereign_key: Vec<u8>,
        sovereign_key_iv: Vec<u8>,
        sovereign_key_tag: Vec<u8>,
    ) -> String {
        // Get existing envelope
        let existing = self.envelopes.get(&envelope_id)
            .expect("Envelope not found");

        // Verify ownership
        assert_eq!(
            env::predecessor_account_id(),
            existing.owner,
            "Only owner can update envelope"
        );

        // Validate inputs
        assert!(!encrypted_data.is_empty(), "Encrypted data cannot be empty");
        assert_eq!(nonce.len(), 24, "Nonce must be 24 bytes");
        assert_eq!(poseidon_commit.len(), 64, "Poseidon commitment must be 64 hex chars");
        assert_eq!(sovereign_key_iv.len(), 12, "AES-GCM IV must be 12 bytes");
        assert_eq!(sovereign_key_tag.len(), 16, "AES-GCM auth tag must be 16 bytes");
        assert!(
            encrypted_data.len() <= MAX_ENVELOPE_SIZE,
            "Encrypted data exceeds maximum size (100KB)"
        );

        // Calculate storage cost difference
        let new_envelope = CipherEnvelope {
            owner: existing.owner.clone(),
            encrypted_data,
            nonce,
            poseidon_commit,
            encrypted_sovereign_key,
            sovereign_key_iv,
            sovereign_key_tag,
            version: existing.version + 1,
            created_at: env::block_timestamp(),
            guardians: existing.guardians,
        };

        let old_cost = self.calculate_storage_cost(&existing);
        let new_cost = self.calculate_storage_cost(&new_envelope);

        // Handle storage balance adjustment
        if new_cost > old_cost {
            let additional_cost = new_cost - old_cost;
            let current_balance = self.storage_balances.get(&existing.owner).unwrap_or(0);
            assert!(
                current_balance >= additional_cost,
                "Insufficient storage deposit for update. Additional required: {} yoctoNEAR",
                additional_cost
            );
            self.storage_balances.insert(&existing.owner, &(current_balance - additional_cost));
        } else if new_cost < old_cost {
            let refund = old_cost - new_cost;
            let current_balance = self.storage_balances.get(&existing.owner).unwrap_or(0);
            self.storage_balances.insert(&existing.owner, &(current_balance + refund));
        }

        // Store with same ID (overwrites)
        self.envelopes.insert(&envelope_id, &new_envelope);

        envelope_id
    }

    /// Delete envelope (owner only) and refund storage cost
    pub fn delete_envelope(&mut self, envelope_id: String) {
        let envelope = self.envelopes.get(&envelope_id)
            .expect("Envelope not found");

        assert_eq!(
            env::predecessor_account_id(),
            envelope.owner,
            "Only owner can delete envelope"
        );

        // Calculate refund
        let refund = self.calculate_storage_cost(&envelope);

        // Refund storage cost to user's balance
        let current_balance = self.storage_balances.get(&envelope.owner).unwrap_or(0);
        let new_balance = current_balance + refund;
        self.storage_balances.insert(&envelope.owner, &new_balance);

        // Remove envelope
        self.envelopes.remove(&envelope_id);
    }

    /// Check if envelope exists
    pub fn envelope_exists(&self, envelope_id: String) -> bool {
        self.envelopes.get(&envelope_id).is_some()
    }

    /// Get envelope count (for testing/stats)
    pub fn get_envelope_count(&self) -> u64 {
        self.envelope_counter
    }

    /// Get contract version
    pub fn get_version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn get_context(predecessor: String) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(predecessor.parse().unwrap());
        builder
    }

    #[test]
    fn test_storage_deposit_and_envelope_creation() {
        let mut context = get_context("alice.near".to_string());
        context.attached_deposit(1_000_000_000_000_000_000_000_000); // 1 NEAR
        testing_env!(context.build());

        let mut contract = CipherVault::new();

        // Deposit storage balance
        let balance = contract.storage_deposit(None, None);
        assert_eq!(balance.total.0, 1_000_000_000_000_000_000_000_000);

        // Store envelope
        let envelope_id = contract.store_envelope(
            vec![1, 2, 3, 4], // encrypted_data
            vec![0; 24],      // nonce (24 bytes)
            "a".repeat(64),   // poseidon_commit (64 hex chars)
            vec![5, 6, 7, 8], // encrypted_sovereign_key
            vec![0; 12],      // sovereign_key_iv (12 bytes)
            vec![0; 16],      // sovereign_key_tag (16 bytes)
            None              // guardians
        );

        assert!(envelope_id.contains("alice.near"));
        assert_eq!(contract.get_envelope_count(), 1);

        // Retrieve envelope
        let envelope = contract.get_envelope(envelope_id.clone()).unwrap();
        assert_eq!(envelope.encrypted_data, vec![1, 2, 3, 4]);
        assert_eq!(envelope.version, 1);
        assert_eq!(envelope.owner.to_string(), "alice.near");
        assert_eq!(envelope.sovereign_key_iv.len(), 12);
        assert_eq!(envelope.sovereign_key_tag.len(), 16);

        // Check storage balance was deducted
        let final_balance = contract.storage_balance_of("alice.near".parse().unwrap()).unwrap();
        assert!(final_balance.available.0 < 1_000_000_000_000_000_000_000_000);
    }

    #[test]
    fn test_public_envelope_retrieval() {
        // Test that anyone can retrieve envelopes (security from encryption, not access control)
        let mut context = get_context("alice.near".to_string());
        context.attached_deposit(1_000_000_000_000_000_000_000_000);
        testing_env!(context.build());

        let mut contract = CipherVault::new();
        contract.storage_deposit(None, None);

        let envelope_id = contract.store_envelope(
            vec![1, 2, 3],
            vec![0; 24],
            "a".repeat(64),
            vec![4, 5, 6],
            vec![0; 12],
            vec![0; 16],
            None
        );

        // Different user can retrieve envelope (but can't decrypt without sovereign key)
        context.predecessor_account_id("bob.near".parse().unwrap());
        testing_env!(context.build());

        let envelope = contract.get_envelope(envelope_id);
        assert!(envelope.is_some());
        assert_eq!(envelope.unwrap().owner.to_string(), "alice.near");
    }

    #[test]
    fn test_update_envelope() {
        let mut context = get_context("alice.near".to_string());
        context.attached_deposit(1_000_000_000_000_000_000_000_000);
        testing_env!(context.build());

        let mut contract = CipherVault::new();
        contract.storage_deposit(None, None);

        // Store initial envelope
        let envelope_id = contract.store_envelope(
            vec![1, 2, 3],
            vec![0; 24],
            "a".repeat(64),
            vec![4, 5, 6],
            vec![0; 12],
            vec![0; 16],
            None
        );

        // Update envelope
        contract.update_envelope(
            envelope_id.clone(),
            vec![7, 8, 9], // new data
            vec![1; 24],
            "b".repeat(64),
            vec![10, 11, 12],
            vec![1; 12],
            vec![1; 16]
        );

        // Retrieve updated envelope
        let envelope = contract.get_envelope(envelope_id).unwrap();
        assert_eq!(envelope.encrypted_data, vec![7, 8, 9]);
        assert_eq!(envelope.version, 2);
    }

    #[test]
    fn test_delete_envelope_with_refund() {
        let mut context = get_context("alice.near".to_string());
        context.attached_deposit(1_000_000_000_000_000_000_000_000);
        testing_env!(context.build());

        let mut contract = CipherVault::new();
        contract.storage_deposit(None, None);

        let balance_before = contract.storage_balance_of("alice.near".parse().unwrap()).unwrap();

        let envelope_id = contract.store_envelope(
            vec![1, 2, 3],
            vec![0; 24],
            "a".repeat(64),
            vec![4, 5, 6],
            vec![0; 12],
            vec![0; 16],
            None
        );

        let balance_after_store = contract.storage_balance_of("alice.near".parse().unwrap()).unwrap();
        assert!(balance_after_store.available.0 < balance_before.available.0);

        assert!(contract.envelope_exists(envelope_id.clone()));

        contract.delete_envelope(envelope_id.clone());

        assert!(!contract.envelope_exists(envelope_id));

        // Check that storage cost was refunded
        let balance_after_delete = contract.storage_balance_of("alice.near".parse().unwrap()).unwrap();
        assert_eq!(balance_after_delete.available.0, balance_before.available.0);
    }

    #[test]
    #[should_panic(expected = "Insufficient storage deposit")]
    fn test_insufficient_storage_deposit() {
        let context = get_context("alice.near".to_string());
        testing_env!(context.build());

        let mut contract = CipherVault::new();

        // Try to store envelope without storage deposit
        contract.store_envelope(
            vec![1, 2, 3],
            vec![0; 24],
            "a".repeat(64),
            vec![4, 5, 6],
            vec![0; 12],
            vec![0; 16],
            None
        );
    }

    #[test]
    #[should_panic(expected = "Nonce must be 24 bytes")]
    fn test_invalid_nonce_length() {
        let mut context = get_context("alice.near".to_string());
        context.attached_deposit(1_000_000_000_000_000_000_000_000);
        testing_env!(context.build());

        let mut contract = CipherVault::new();
        contract.storage_deposit(None, None);

        contract.store_envelope(
            vec![1, 2, 3],
            vec![0; 16], // Wrong length - should be 24
            "a".repeat(64),
            vec![4, 5, 6],
            vec![0; 12],
            vec![0; 16],
            None
        );
    }

    #[test]
    #[should_panic(expected = "AES-GCM IV must be 12 bytes")]
    fn test_invalid_iv_length() {
        let mut context = get_context("alice.near".to_string());
        context.attached_deposit(1_000_000_000_000_000_000_000_000);
        testing_env!(context.build());

        let mut contract = CipherVault::new();
        contract.storage_deposit(None, None);

        contract.store_envelope(
            vec![1, 2, 3],
            vec![0; 24],
            "a".repeat(64),
            vec![4, 5, 6],
            vec![0; 10], // Wrong length - should be 12
            vec![0; 16],
            None
        );
    }

    #[test]
    #[should_panic(expected = "AES-GCM auth tag must be 16 bytes")]
    fn test_invalid_tag_length() {
        let mut context = get_context("alice.near".to_string());
        context.attached_deposit(1_000_000_000_000_000_000_000_000);
        testing_env!(context.build());

        let mut contract = CipherVault::new();
        contract.storage_deposit(None, None);

        contract.store_envelope(
            vec![1, 2, 3],
            vec![0; 24],
            "a".repeat(64),
            vec![4, 5, 6],
            vec![0; 12],
            vec![0; 12], // Wrong length - should be 16
            None
        );
    }

    #[test]
    #[should_panic(expected = "Encrypted data exceeds maximum size")]
    fn test_envelope_size_limit() {
        let mut context = get_context("alice.near".to_string());
        context.attached_deposit(10_000_000_000_000_000_000_000_000); // 10 NEAR
        testing_env!(context.build());

        let mut contract = CipherVault::new();
        contract.storage_deposit(None, None);

        // Try to store 101KB (exceeds 100KB limit)
        contract.store_envelope(
            vec![0; 101_000],
            vec![0; 24],
            "a".repeat(64),
            vec![4, 5, 6],
            vec![0; 12],
            vec![0; 16],
            None
        );
    }

    #[test]
    #[should_panic(expected = "Poseidon commitment must be 32 bytes (64 hex chars)")]
    fn test_invalid_commitment_length() {
        let mut context = get_context("alice.near".to_string());
        context.attached_deposit(1_000_000_000_000_000_000_000_000);
        testing_env!(context.build());

        let mut contract = CipherVault::new();
        contract.storage_deposit(None, None);

        contract.store_envelope(
            vec![1, 2, 3],
            vec![0; 24],
            "short", // Wrong length - should be 64 chars
            vec![4, 5, 6],
            vec![0; 12],
            vec![0; 16],
            None
        );
    }
}
