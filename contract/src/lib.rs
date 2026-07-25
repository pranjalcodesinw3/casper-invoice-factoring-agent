#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]
extern crate alloc;

pub mod receivable_escrow;

#[cfg(test)]
mod tests;
