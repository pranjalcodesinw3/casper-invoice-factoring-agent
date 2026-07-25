//! `fund_note`: the payable path where real value moves.
//!
//! This is the only entrypoint that touches native tokens, so it is the one
//! where a mistake costs money rather than a revert. The tests assert the
//! seller's balance actually changed, not merely that an event was emitted: an
//! event is what the contract *says* happened, and a balance is what did.

use odra::casper_types::U512;
use odra::host::HostRef;
use odra::prelude::Addressable;

use crate::receivable_escrow::{Error, NoteFunded};
use crate::tests::harness::{risk_hash, setup, INVESTOR, OWNER, SELLER, STRANGER};

#[test]
fn fund_note_with_correct_amount_pays_seller_and_emits_event() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let face_value = U512::from(5_000u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(5, seller, face_value, 75, risk_hash());

    let seller_balance_before = env.balance_of(&seller);

    env.set_caller(investor);
    contract.with_tokens(face_value).fund_note(5);

    assert_eq!(
        env.balance_of(&seller),
        seller_balance_before + face_value,
        "the seller must actually receive the funding, not just an event"
    );

    let note = contract.get_note(5).expect("note should exist");
    assert_eq!(note.investor, Some(investor));
    assert_eq!(note.status, 1);

    assert!(env.emitted_event(
        &contract,
        NoteFunded {
            note_id: 5,
            investor,
            face_value,
            seller,
        }
    ));
}

/// The escrow forwards the whole amount. If it retained any, the seller would
/// be silently short-changed and the difference would sit in the contract.
#[test]
fn the_escrow_keeps_nothing_it_forwards_the_entire_face_value() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let face_value = U512::from(7_777u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(30, seller, face_value, 75, risk_hash());

    let escrow_before = env.balance_of(&contract.address());
    let seller_before = env.balance_of(&seller);

    env.set_caller(investor);
    contract.with_tokens(face_value).fund_note(30);

    assert_eq!(
        env.balance_of(&seller) - seller_before,
        face_value,
        "seller receives the full face value"
    );
    assert_eq!(
        env.balance_of(&contract.address()),
        escrow_before,
        "the escrow must not retain a cut"
    );
}

#[test]
fn fund_note_reverts_on_wrong_amount() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let face_value = U512::from(5_000u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(6, seller, face_value, 75, risk_hash());

    env.set_caller(investor);
    assert_eq!(
        contract.with_tokens(U512::from(4_999u64)).try_fund_note(6),
        Err(Error::WrongAmount.into())
    );
}

/// Exact-amount means exact in both directions. Overpaying is refused too,
/// because the contract has no refund path: accepting 6000 for a 5000 note
/// would forward 6000 to the seller and quietly overpay from the investor.
#[test]
fn overpaying_is_refused_just_like_underpaying() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let face_value = U512::from(5_000u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(31, seller, face_value, 75, risk_hash());

    env.set_caller(investor);
    assert_eq!(
        contract
            .with_tokens(face_value + U512::one())
            .try_fund_note(31),
        Err(Error::WrongAmount.into()),
        "one mote over must be refused"
    );
    assert_eq!(
        contract.with_tokens(U512::zero()).try_fund_note(31),
        Err(Error::WrongAmount.into()),
        "funding with nothing attached must be refused"
    );
}

/// A refused funding must move no money and leave the note fundable.
#[test]
fn a_refused_funding_moves_no_money_and_leaves_the_note_open() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let face_value = U512::from(5_000u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(32, seller, face_value, 75, risk_hash());

    let seller_before = env.balance_of(&seller);

    env.set_caller(investor);
    let _ = contract.with_tokens(U512::from(1u64)).try_fund_note(32);

    assert_eq!(env.balance_of(&seller), seller_before, "no partial payment");

    let note = contract.get_note(32).expect("note should exist");
    assert_eq!(note.status, 0, "note stays Open after a refused funding");
    assert_eq!(note.investor, None, "no investor is recorded");

    // And it can still be funded correctly afterwards.
    contract.with_tokens(face_value).fund_note(32);
    assert_eq!(contract.get_note(32).unwrap().status, 1);
}

#[test]
fn fund_note_reverts_when_already_funded() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let second_investor = env.get_account(STRANGER);
    let face_value = U512::from(5_000u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(7, seller, face_value, 75, risk_hash());

    env.set_caller(investor);
    contract.with_tokens(face_value).fund_note(7);

    env.set_caller(second_investor);
    assert_eq!(
        contract.with_tokens(face_value).try_fund_note(7),
        Err(Error::AlreadyFunded.into())
    );
}

/// The double-funding guard is the one that protects an investor's money: a
/// second funder must not pay the seller again and must not displace the
/// recorded investor.
#[test]
fn a_second_investor_cannot_displace_the_first_or_pay_twice() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let latecomer = env.get_account(STRANGER);
    let face_value = U512::from(5_000u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(33, seller, face_value, 75, risk_hash());

    env.set_caller(investor);
    contract.with_tokens(face_value).fund_note(33);

    let seller_after_first = env.balance_of(&seller);

    env.set_caller(latecomer);
    let _ = contract.with_tokens(face_value).try_fund_note(33);

    assert_eq!(
        env.balance_of(&seller),
        seller_after_first,
        "the seller must not be paid a second time"
    );
    assert_eq!(
        contract.get_note(33).unwrap().investor,
        Some(investor),
        "the original investor keeps the claim"
    );
}

#[test]
fn fund_note_reverts_for_missing_note() {
    let (env, contract) = setup();

    env.set_caller(env.get_account(INVESTOR));
    assert_eq!(
        contract
            .with_tokens(U512::from(1_000u64))
            .try_fund_note(999),
        Err(Error::NoNote.into())
    );
}

/// Anyone may fund: the investor side is permissionless by design, and only
/// the underwriting side is owner-gated. Worth pinning, because an accidental
/// `assert_owner` here would quietly turn the product into a single-party one.
#[test]
fn funding_is_permissionless_any_account_may_be_the_investor() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);
    let stranger = env.get_account(STRANGER);
    let face_value = U512::from(1_500u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(34, seller, face_value, 75, risk_hash());

    env.set_caller(stranger);
    contract.with_tokens(face_value).fund_note(34);

    assert_eq!(contract.get_note(34).unwrap().investor, Some(stranger));
}
