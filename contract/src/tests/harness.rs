//! Shared deployment harness for the escrow test suites.
//!
//! Every suite deploys the same way, so the setup lives here rather than being
//! copied into each file and drifting. `MIN_RISK_SCORE` is deliberately a
//! constant the tests import rather than a literal they each restate: the
//! whole point of the risk gate is that the threshold lives in one place, and a
//! test file that hardcodes 50 would still pass if the contract's default
//! changed underneath it.

use odra::casper_types::U512;
use odra::host::{Deployer, HostEnv, HostRef};

use crate::receivable_escrow::{
    ReceivableEscrow, ReceivableEscrowHostRef, ReceivableEscrowInitArgs,
};

/// The minimum acceptable risk score the escrow is initialised with.
pub const MIN_RISK_SCORE: u64 = 50;

/// The collateral an underwriter must stake before it may open notes.
pub const MIN_BOND: u64 = 10_000u64;

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
            min_bond: U512::from(MIN_BOND),
        },
    );
    (env, contract)
}

/// Deploys an escrow whose owner has already staked the minimum bond.
///
/// Most tests care about note behaviour rather than about bonding, and an
/// unbonded owner cannot open notes at all, so this is the default starting
/// point. Tests that are specifically about the bond gate use `setup()` and
/// stake explicitly.
pub fn setup_bonded() -> (HostEnv, ReceivableEscrowHostRef) {
    let (env, contract) = setup();
    env.set_caller(env.get_account(OWNER));
    contract.with_tokens(U512::from(MIN_BOND)).post_bond();
    (env, contract)
}

/// A risk-data hash of the right shape. The contract stores it verbatim and
/// does not interpret it, so the value only has to be stable across tests.
pub fn risk_hash() -> String {
    "a".repeat(64)
}
