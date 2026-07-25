//! `open_note`: who may create a note, and on what terms.
//!
//! This is the underwriting gate. Everything downstream (funding, repayment)
//! assumes a note only exists because the risk score cleared the on-chain
//! minimum, so these are the tests that make that assumption true.

use odra::casper_types::U512;

use crate::receivable_escrow::{Error, NoteOpened};
use crate::tests::harness::{risk_hash, setup_bonded, MIN_RISK_SCORE, OWNER, SELLER, STRANGER};

#[test]
fn init_sets_owner_and_min_risk_score() {
    let (env, contract) = setup_bonded();
    assert_eq!(contract.get_owner(), env.get_account(OWNER));
    assert_eq!(contract.get_min_risk_score(), MIN_RISK_SCORE);
}

#[test]
fn open_note_with_acceptable_risk_emits_event() {
    let (env, mut contract) = setup_bonded();
    let seller = env.get_account(SELLER);
    let face_value = U512::from(10_000u64);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(1, seller, face_value, 80, risk_hash());

    assert!(env.emitted_event(
        &contract,
        NoteOpened {
            note_id: 1,
            seller,
            face_value,
            risk_score: 80,
            risk_data_hash: risk_hash(),
        }
    ));

    let note = contract.get_note(1).expect("note should exist");
    assert_eq!(note.seller, seller);
    assert_eq!(note.investor, None);
    assert_eq!(note.face_value, face_value);
    assert_eq!(note.risk_score, 80);
    assert_eq!(note.risk_data_hash, risk_hash());
    assert_eq!(note.status, 0, "a new note must start Open");
}

#[test]
fn open_note_reverts_when_risk_too_high() {
    let (env, mut contract) = setup_bonded();
    let seller = env.get_account(SELLER);

    env.set_caller(env.get_account(OWNER));
    assert_eq!(
        contract.try_open_note(2, seller, U512::from(1_000u64), 10, risk_hash()),
        Err(Error::RiskTooHigh.into())
    );
    assert!(
        contract.get_note(2).is_none(),
        "a rejected note must not be persisted"
    );
}

/// The boundary is the whole mechanism. A gate that is off by one either funds
/// paper it should have refused, or refuses paper it should have funded, and
/// only a test that lands exactly on the threshold can tell the difference.
#[test]
fn the_risk_gate_is_inclusive_at_the_minimum_and_exclusive_below_it() {
    let (env, mut contract) = setup_bonded();
    let seller = env.get_account(SELLER);
    env.set_caller(env.get_account(OWNER));

    // Exactly at the minimum: accepted.
    contract.open_note(
        10,
        seller,
        U512::from(1_000u64),
        MIN_RISK_SCORE,
        risk_hash(),
    );
    assert!(contract.get_note(10).is_some());

    // One below: refused.
    assert_eq!(
        contract.try_open_note(
            11,
            seller,
            U512::from(1_000u64),
            MIN_RISK_SCORE - 1,
            risk_hash()
        ),
        Err(Error::RiskTooHigh.into())
    );

    // A perfect score is not special-cased into some other branch.
    contract.open_note(12, seller, U512::from(1_000u64), 100, risk_hash());
    assert!(contract.get_note(12).is_some());
}

#[test]
fn open_note_reverts_on_duplicate_note_id() {
    let (env, mut contract) = setup_bonded();
    let seller = env.get_account(SELLER);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(3, seller, U512::from(1_000u64), 90, risk_hash());

    assert_eq!(
        contract.try_open_note(3, seller, U512::from(1_000u64), 90, "other".to_string()),
        Err(Error::NoteExists.into())
    );
}

/// A duplicate id must not quietly overwrite the first note's terms. If it did,
/// an underwriter could re-price a note after an investor had read it.
#[test]
fn a_rejected_duplicate_leaves_the_original_note_untouched() {
    let (env, mut contract) = setup_bonded();
    let seller = env.get_account(SELLER);
    let stranger = env.get_account(STRANGER);

    env.set_caller(env.get_account(OWNER));
    contract.open_note(20, seller, U512::from(1_000u64), 90, risk_hash());

    let _ = contract.try_open_note(20, stranger, U512::from(999_999u64), 51, "b".repeat(64));

    let note = contract.get_note(20).expect("original must survive");
    assert_eq!(note.seller, seller, "seller must not be rewritten");
    assert_eq!(
        note.face_value,
        U512::from(1_000u64),
        "price must not be rewritten"
    );
    assert_eq!(note.risk_score, 90, "risk score must not be rewritten");
    assert_eq!(
        note.risk_data_hash,
        risk_hash(),
        "provenance must not be rewritten"
    );
}

#[test]
fn open_note_reverts_for_non_owner() {
    let (env, mut contract) = setup_bonded();
    let seller = env.get_account(SELLER);

    env.set_caller(env.get_account(STRANGER));
    assert_eq!(
        contract.try_open_note(4, seller, U512::from(1_000u64), 90, risk_hash()),
        Err(Error::NotOwner.into())
    );
}

/// Access control must be checked before the business rules, so a stranger
/// learns nothing about the escrow's terms from the error they get back.
#[test]
fn a_stranger_is_refused_as_not_owner_even_when_the_note_is_otherwise_invalid() {
    let (env, mut contract) = setup_bonded();
    let seller = env.get_account(SELLER);

    env.set_caller(env.get_account(STRANGER));
    assert_eq!(
        contract.try_open_note(5, seller, U512::from(1_000u64), 1, risk_hash()),
        Err(Error::NotOwner.into()),
        "ownership is checked before the risk gate"
    );
}
