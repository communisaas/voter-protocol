// src/token.rs

use solana_program::{program_pack::Pack, pubkey::Pubkey};

#[repr(C)]
pub struct ReadToken {
    pub name: [u8; 32],
    pub symbol: [u8; 8],
    pub total_supply: u64,
    pub owner: Pubkey,
}

impl ReadToken {
    // methods for the token go here
}
