//! `mark_repaid`, and the lifecycle as a whole.
//!
//! The status field is the note's state machine: 0 Open, 1 Funded, 2 Repaid.
//! Every rule worth having is a statement about which transitions are legal, so
//! these tests walk the legal path once and then try each illegal edge.

use odra::casper_types::U512;
use odra::host::HostRef;

use crate::receivable_escrow::{Error, NoteRepaid};
use crate::tests::harness::{risk_hash, setup, INVESTOR, OWNER, SELLER, STRANGER};

#[test]
fn mark_repaid_after_funding_emits_event() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let face_value = U512::from(2_500u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(8, seller, face_value, 60, risk_hash());

    env.set_caller(investor);
    contract.with_tokens(face_value).fund_note(8);

    env.set_caller(env.get_account(OWNER));
    contract.mark_repaid(8);

    assert_eq!(contract.get_note(8).expect("note should exist").status, 2);
    assert!(env.emitted_event(&contract, NoteRepaid { note_id: 8 }));
}

#[test]
fn mark_repaid_reverts_when_not_funded() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(9, seller, U512::from(1_000u64), 60, risk_hash());

    assert_eq!(contract.try_mark_repaid(9), Err(Error::NotFunded.into()));
}

#[test]
fn mark_repaid_reverts_for_missing_note() {
    let (env, mut contract) = setup();

    env.set_caller(env.get_account(OWNER));
    assert_eq!(contract.try_mark_repaid(999), Err(Error::NoNote.into()));
}

/// Repayment is terminal. Marking twice must fail, or the event log would show
/// a note repaid more times than it was funded.
#[test]
fn a_note_cannot_be_repaid_twice() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let face_value = U512::from(2_000u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(40, seller, face_value, 60, risk_hash());
    env.set_caller(investor);
    contract.with_tokens(face_value).fund_note(40);
    env.set_caller(env.get_account(OWNER));
    contract.mark_repaid(40);

    assert_eq!(
        contract.try_mark_repaid(40),
        Err(Error::NotFunded.into()),
        "a repaid note is no longer in the Funded state"
    );
    assert_eq!(contract.get_note(40).unwrap().status, 2);
}

/// A repaid note is closed to funding. Without this, an investor could pay a
/// note whose obligation had already been settled.
#[test]
fn a_repaid_note_cannot_be_funded_again() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let latecomer = env.get_account(STRANGER);
    let face_value = U512::from(2_000u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(41, seller, face_value, 60, risk_hash());
    env.set_caller(investor);
    contract.with_tokens(face_value).fund_note(41);
    env.set_caller(env.get_account(OWNER));
    contract.mark_repaid(41);

    let seller_before = env.balance_of(&seller);
    env.set_caller(latecomer);
    assert_eq!(
        contract.with_tokens(face_value).try_fund_note(41),
        Err(Error::AlreadyFunded.into())
    );
    assert_eq!(env.balance_of(&seller), seller_before, "no further payment");
}

/// Only the underwriter may declare repayment. An investor marking their own
/// note repaid would be marking their own homework.
#[test]
fn only_the_owner_can_mark_a_note_repaid() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let face_value = U512::from(2_000u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(42, seller, face_value, 60, risk_hash());
    env.set_caller(investor);
    contract.with_tokens(face_value).fund_note(42);

    // The investor, who has the most to gain, still cannot close the note.
    assert_eq!(contract.try_mark_repaid(42), Err(Error::NotOwner.into()));

    env.set_caller(env.get_account(STRANGER));
    assert_eq!(contract.try_mark_repaid(42), Err(Error::NotOwner.into()));

    assert_eq!(
        contract.get_note(42).unwrap().status,
        1,
        "the note is still merely Funded"
    );
}

/// The one legal path, end to end, asserted on state rather than on events.
#[test]
fn the_full_lifecycle_walks_open_then_funded_then_repaid() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);
    let face_value = U512::from(3_000u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(43, seller, face_value, 88, risk_hash());
    assert_eq!(contract.get_note(43).unwrap().status, 0);

    env.set_caller(investor);
    contract.with_tokens(face_value).fund_note(43);
    assert_eq!(contract.get_note(43).unwrap().status, 1);

    env.set_caller(env.get_account(OWNER));
    contract.mark_repaid(43);

    let note = contract.get_note(43).unwrap();
    assert_eq!(note.status, 2);
    assert_eq!(
        note.investor,
        Some(investor),
        "the investor survives the whole lifecycle"
    );
    assert_eq!(note.risk_data_hash, risk_hash(), "provenance survives too");
}

/// Notes are independent. A bug that keyed state globally rather than per-note
/// would show up here and nowhere else.
#[test]
fn notes_do_not_interfere_with_each_other() {
    let (env, mut contract) = setup();
    let seller = env.get_account(SELLER);
    let investor = env.get_account(INVESTOR);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(50, seller, U512::from(1_000u64), 60, risk_hash());
    contract.open_note(51, seller, U512::from(2_000u64), 90, risk_hash());

    env.set_caller(investor);
    contract.with_tokens(U512::from(1_000u64)).fund_note(50);

    assert_eq!(contract.get_note(50).unwrap().status, 1, "50 is funded");
    assert_eq!(contract.get_note(51).unwrap().status, 0, "51 is untouched");

    env.set_caller(env.get_account(OWNER));
    contract.mark_repaid(50);
    assert_eq!(
        contract.get_note(51).unwrap().status,
        0,
        "51 still untouched"
    );
    assert_eq!(
        contract.try_mark_repaid(51),
        Err(Error::NotFunded.into()),
        "51 keeps its own state machine"
    );
}
