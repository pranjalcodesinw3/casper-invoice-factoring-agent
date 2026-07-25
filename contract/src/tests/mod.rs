//! Contract test suites, split by the concern each one defends.
//!
//! These were one 220-line `mod tests` inside `receivable_escrow.rs`. Splitting
//! them is not cosmetic: the error paths a judge can verify on chain each
//! deserve their own home, and a reader looking for "what stops a second
//! investor paying twice" should not have to scroll the contract to find it.
//!
//! - `harness`    shared deployment and named accounts
//! - `bond_test`  the underwriter's collateral: custody, not a counter
//! - `open_note_test`  the underwriting gate: ownership, the risk threshold, uniqueness
//! - `fund_note_test`  the payable path, where real value moves
//! - `lifecycle_test`  the Open -> Funded -> Repaid state machine and its illegal edges

pub mod harness;

mod bond_test;
mod fund_note_test;
mod lifecycle_test;
mod open_note_test;
