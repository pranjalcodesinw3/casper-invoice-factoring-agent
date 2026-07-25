//! The underwriter bond: collateral as custody, and what slashing actually moves.
//!
//! The claim this suite defends is narrow and physical: CSPR enters the
//! contract's purse when a bond is posted, and leaves it when a note defaults.
//! Every test here therefore asserts on **balances**, not on events or on a
//! stored integer. A bond that only increments a counter would pass an
//! event-shaped test and fail every test in this file.
//!
//! That distinction is the wedge. Bonded, slashable scoring exists elsewhere in
//! this field; Wardens Protocol (46792) has a full challenge court. But its own
//! source calls the bond "an internal U512 ledger inside the contract rather
//! than real purse locking" and a "simulated purse", and the repository has no
//! `payable` entrypoint at all. These tests are what it would take to prove the
//! difference.

use odra::casper_types::U512;
use odra::host::HostRef;
use odra::prelude::Addressable;

use crate::receivable_escrow::Error;
use crate::tests::harness::{
    risk_hash, setup, setup_bonded, INVESTOR, MIN_BOND, OWNER, SELLER, STRANGER,
};

#[test]
fn an_unbonded_underwriter_cannot_open_notes_at_all() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);

    env.set_caller(env.get_account(OWNER));
    assert_eq!(
        contract.try_open_note(1, seller, U512::from(1_000u64), 90, risk_hash()),
        Err(Error::NotBonded.into()),
        "the bond is a precondition of underwriting, not a badge beside it"
    );
}

#[test]
fn posting_a_bond_moves_cspr_into_the_contract() {
    let (env, contract) = setup();
    let owner = env.get_account(OWNER);
    let contract_before = env.balance_of(&contract.address());

    env.set_caller(owner);
    contract.with_tokens(U512::from(MIN_BOND)).post_bond();

    assert_eq!(
        env.balance_of(&contract.address()) - contract_before,
        U512::from(MIN_BOND),
        "the collateral must actually be held, not merely recorded"
    );
    assert_eq!(contract.get_bond(owner).amount, U512::from(MIN_BOND));
    assert!(contract.is_bonded(owner));
}

#[test]
fn a_bond_below_the_minimum_does_not_unlock_underwriting() {
    let (env, mut contract) = setup();
    let owner = env.get_account(OWNER);
    let seller = env.get_account(SELLER);

    env.set_caller(owner);
    contract
        .with_tokens(U512::from(MIN_BOND) - U512::one())
        .post_bond();

    assert!(!contract.is_bonded(owner), "one mote short is short");
    assert_eq!(
        contract.try_open_note(1, seller, U512::from(100u64), 90, risk_hash()),
        Err(Error::NotBonded.into())
    );

    // Topping up to exactly the minimum unlocks it.
    contract.with_tokens(U512::one()).post_bond();
    assert!(contract.is_bonded(owner));
    contract.open_note(1, seller, U512::from(100u64), 90, risk_hash());
}

#[test]
fn a_zero_bond_is_refused() {
    let (env, contract) = setup();
    env.set_caller(env.get_account(OWNER));
    assert_eq!(
        contract.with_tokens(U512::zero()).try_post_bond(),
        Err(Error::ZeroBond.into())
    );
}

#[test]
fn withdrawing_returns_the_collateral_and_relocks_underwriting() {
    let (env, mut contract) = setup_bonded();
    let owner = env.get_account(OWNER);
    let seller = env.get_account(SELLER);

    let contract_before = env.balance_of(&contract.address());
    env.set_caller(owner);
    contract.withdraw_bond(U512::from(MIN_BOND));

    assert_eq!(
        contract_before - env.balance_of(&contract.address()),
        U512::from(MIN_BOND),
        "the CSPR must leave the contract's purse"
    );
    assert!(!contract.is_bonded(owner));
    assert_eq!(
        contract.try_open_note(1, seller, U512::from(100u64), 90, risk_hash()),
        Err(Error::NotBonded.into()),
        "withdrawing the stake withdraws the right to underwrite"
    );
}

#[test]
fn withdrawing_more_than_is_held_is_refused_rather_than_capped() {
    let (env, mut contract) = setup_bonded();
    env.set_caller(env.get_account(OWNER));
    assert_eq!(
        contract.try_withdraw_bond(U512::from(MIN_BOND) + U512::one()),
        Err(Error::BondTooSmall.into()),
        "silently sending less would hide the underwriter's mistake"
    );
}

/// The headline test. A default must move real value from the contract's purse
/// to the investor who funded the note.
#[test]
fn a_default_pays_the_investor_out_of_the_bond() {
    let (env, mut contract) = setup_bonded();
    let owner = env.get_account(OWNER);
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let face_value = U512::from(1_000u64);

    env.set_caller(owner);
    contract.open_note(1, seller, face_value, 90, risk_hash());
    env.set_caller(investor);
    contract.with_tokens(face_value).fund_note(1);

    let investor_before = env.balance_of(&investor);
    let contract_before = env.balance_of(&contract.address());

    env.set_caller(owner);
    contract.declare_default(1);

    assert_eq!(
        env.balance_of(&investor) - investor_before,
        face_value,
        "the investor is made whole from the bond"
    );
    assert_eq!(
        contract_before - env.balance_of(&contract.address()),
        face_value,
        "and that CSPR actually left the contract"
    );

    let bond = contract.get_bond(owner);
    assert_eq!(bond.amount, U512::from(MIN_BOND) - face_value);
    assert_eq!(bond.slashed, face_value);
    assert_eq!(bond.defaults, 1);
    assert_eq!(contract.get_note(1).unwrap().status, 3, "note is Defaulted");
}

/// The bond caps the payout. A note larger than the collateral cannot pay out
/// more than was staked, and the shortfall must be visible rather than implied.
#[test]
fn a_default_larger_than_the_bond_pays_only_what_was_staked() {
    let (env, mut contract) = setup_bonded();
    let owner = env.get_account(OWNER);
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let face_value = U512::from(MIN_BOND) * 3; // deliberately under-collateralised

    env.set_caller(owner);
    contract.open_note(1, seller, face_value, 90, risk_hash());
    env.set_caller(investor);
    contract.with_tokens(face_value).fund_note(1);

    let investor_before = env.balance_of(&investor);
    env.set_caller(owner);
    contract.declare_default(1);

    assert_eq!(
        env.balance_of(&investor) - investor_before,
        U512::from(MIN_BOND),
        "the payout is capped at the collateral actually staked"
    );
    assert_eq!(
        contract.get_bond(owner).amount,
        U512::zero(),
        "the bond is exhausted, not overdrawn"
    );
}

#[test]
fn a_note_cannot_default_twice() {
    let (env, mut contract) = setup_bonded();
    let owner = env.get_account(OWNER);
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let face_value = U512::from(100u64);

    env.set_caller(owner);
    contract.open_note(1, seller, face_value, 90, risk_hash());
    env.set_caller(investor);
    contract.with_tokens(face_value).fund_note(1);
    env.set_caller(owner);
    contract.declare_default(1);

    let investor_after_first = env.balance_of(&investor);
    assert_eq!(
        contract.try_declare_default(1),
        Err(Error::NotDefaultable.into()),
        "a defaulted note is no longer funded"
    );
    assert_eq!(
        env.balance_of(&investor),
        investor_after_first,
        "and no second payout is made"
    );
}

#[test]
fn an_unfunded_note_cannot_default_because_there_is_nobody_to_repay() {
    let (env, mut contract) = setup_bonded();
    let seller = env.get_account(SELLER);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(1, seller, U512::from(100u64), 90, risk_hash());

    assert_eq!(
        contract.try_declare_default(1),
        Err(Error::NotDefaultable.into())
    );
}

#[test]
fn a_repaid_note_cannot_be_declared_in_default_afterwards() {
    let (env, mut contract) = setup_bonded();
    let owner = env.get_account(OWNER);
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let face_value = U512::from(100u64);

    env.set_caller(owner);
    contract.open_note(1, seller, face_value, 90, risk_hash());
    env.set_caller(investor);
    contract.with_tokens(face_value).fund_note(1);
    env.set_caller(owner);
    contract.mark_repaid(1);

    assert_eq!(
        contract.try_declare_default(1),
        Err(Error::NotDefaultable.into()),
        "settled debt cannot be retroactively defaulted to drain the bond"
    );
}

#[test]
fn only_the_owner_can_declare_a_default() {
    let (env, mut contract) = setup_bonded();
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let face_value = U512::from(100u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(1, seller, face_value, 90, risk_hash());
    env.set_caller(investor);
    contract.with_tokens(face_value).fund_note(1);

    // The investor is the one who profits from a default, and still cannot
    // declare one.
    assert_eq!(contract.try_declare_default(1), Err(Error::NotOwner.into()));

    env.set_caller(env.get_account(STRANGER));
    assert_eq!(contract.try_declare_default(1), Err(Error::NotOwner.into()));
}

#[test]
fn declaring_a_default_on_a_note_that_does_not_exist_is_refused() {
    let (env, mut contract) = setup_bonded();
    env.set_caller(env.get_account(OWNER));
    assert_eq!(contract.try_declare_default(999), Err(Error::NoNote.into()));
}

/// A refused default must move nothing. This is the test that would catch a
/// transfer accidentally placed before the status check.
#[test]
fn a_refused_default_leaves_every_balance_untouched() {
    let (env, mut contract) = setup_bonded();
    let owner = env.get_account(OWNER);
    let seller = env.get_account(SELLER);

    env.set_caller(owner);
    contract.open_note(1, seller, U512::from(100u64), 90, risk_hash());

    let contract_before = env.balance_of(&contract.address());
    let bond_before = contract.get_bond(owner).amount;

    let _ = contract.try_declare_default(1); // unfunded: refused

    assert_eq!(env.balance_of(&contract.address()), contract_before);
    assert_eq!(contract.get_bond(owner).amount, bond_before);
    assert_eq!(contract.get_bond(owner).defaults, 0);
}
