//! Shared deployment harness for the escrow test suites.
//!
//! Every suite deploys the same way, so the setup lives here rather than being
//! copied into each file and drifting. `MIN_RISK_SCORE` is deliberately a
//! constant the tests import rather than a literal they each restate: the
//! whole point of the risk gate is that the threshold lives in one place, and a
//! test file that hardcodes 50 would still pass if the contract's default
//! changed underneath it.

use odra::host::{Deployer, HostEnv};

use crate::receivable_escrow::{
    ReceivableEscrow, ReceivableEscrowHostRef, ReceivableEscrowInitArgs,
};

/// The minimum acceptable risk score the escrow is initialised with.
pub const MIN_RISK_SCORE: u64 = 50;

/// Account 0 deploys and therefore owns the escrow.
pub const OWNER: usize = 0;
/// Account 1 stands in for the seller who is owed the receivable.
pub const SELLER: usize = 1;
/// Account 2 stands in for the investor funding a note.
pub const INVESTOR: usize = 2;
/// Account 3 is an unrelated third party, used to prove access control.
pub const STRANGER: usize = 3;

/// Deploys a fresh escrow owned by account 0.
pub fn setup() -> (HostEnv, ReceivableEscrowHostRef) {
    let env = odra_test::env();
    env.set_caller(env.get_account(OWNER));
    let contract = ReceivableEscrow::deploy(
        &env,
        ReceivableEscrowInitArgs {
            min_risk_score: MIN_RISK_SCORE,
        },
    );
    (env, contract)
}

/// A risk-data hash of the right shape. The contract stores it verbatim and
/// does not interpret it, so the value only has to be stable across tests.
pub fn risk_hash() -> String {
    "a".repeat(64)
}
