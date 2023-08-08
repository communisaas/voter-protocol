// src/instruction.rs

use solana_program::{
    self, account_info::AccountInfo, instruction::Instruction, program_error::ProgramError,
};

pub enum TokenInstruction {
    InitializeToken {
        name: [u8; 32],
        symbol: [u8; 8],
        total_supply: u64,
    },
    // token-related instructions go here
}

impl TokenInstruction {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        // unpack the instruction
        Ok(TokenInstruction::InitializeToken {
            name: [0; 32],
            symbol: [0; 8],
            total_supply: 0,
        })
    }
}
