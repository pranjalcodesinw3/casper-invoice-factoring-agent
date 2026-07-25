//! ReceivableEscrow: an on-chain receivable note registry with funding escrow.
//!
//! An owner (the agentic underwriter) opens a receivable note for a seller once
//! off-chain risk data clears a minimum risk-score bar. An investor then funds the
//! note by attaching native tokens equal to the note's face value; the escrow
//! forwards the funds straight to the seller and records the investor. The owner
//! later marks the note repaid once the debtor settles off-chain.
//!
//! This module exercises owner-gated writes, struct-in-mapping storage
//! (`#[odra::odra_type]`), typed errors (`#[odra::odra_error]`), events
//! (`#[odra::event]`), a payable entrypoint that forwards native tokens
//! (`#[odra(payable)]` + `transfer_tokens`), and `Option<Address>` as an
//! odra_type field.

use odra::casper_types::U512;
use odra::prelude::*;

/// A receivable note tracked by the escrow.
///
/// `investor` is `None` until the note is funded, then holds the funding
/// investor's address. `status` is `0` (Open), `1` (Funded), or `2` (Repaid).
#[odra::odra_type]
pub struct Note {
    /// The supplier who owns the underlying invoice and receives funding.
    pub seller: Address,
    /// The investor who funded the note, once funded.
    pub investor: Option<Address>,
    /// The invoice face value in motes; also the exact amount an investor
    /// must attach to fund the note.
    pub face_value: U512,
    /// Underwriting risk score on a 0-100 scale (higher is safer).
    pub risk_score: u64,
    /// Hash pointer to the off-chain risk data attestation.
    pub risk_data_hash: String,
    /// Lifecycle status: 0 = Open, 1 = Funded, 2 = Repaid.
    pub status: u8,
}

/// Errors returned to callers. Field-less enum with explicit discriminants so the
/// on-chain error codes are stable across builds.
#[odra::odra_error]
pub enum Error {
    /// A non-owner tried to call an owner-only entrypoint.
    NotOwner = 1,
    /// A note with this id already exists.
    NoteExists = 2,
    /// The submitted risk score is below the configured minimum.
    RiskTooHigh = 3,
    /// No note exists for the given id.
    NoNote = 4,
    /// The note has already been funded.
    AlreadyFunded = 5,
    /// The attached native token amount does not equal the note's face value.
    WrongAmount = 6,
    /// The note has not been funded yet, so it cannot be marked repaid.
    NotFunded = 7,
}

/// Emitted when the owner opens a new receivable note.
#[odra::event]
pub struct NoteOpened {
    pub note_id: u64,
    pub seller: Address,
    pub face_value: U512,
    pub risk_score: u64,
    pub risk_data_hash: String,
}

/// Emitted when an investor funds a note and the escrow forwards value to the seller.
#[odra::event]
pub struct NoteFunded {
    pub note_id: u64,
    pub investor: Address,
    pub face_value: U512,
    pub seller: Address,
}

/// Emitted when the owner marks a funded note as repaid.
#[odra::event]
pub struct NoteRepaid {
    pub note_id: u64,
}

/// The ReceivableEscrow contract module.
#[odra::module(
    events = [NoteOpened, NoteFunded, NoteRepaid],
    errors = Error
)]
pub struct ReceivableEscrow {
    owner: Var<Address>,
    min_risk_score: Var<u64>,
    notes: Mapping<u64, Note>,
}

#[odra::module]
impl ReceivableEscrow {
    /// Initializes the escrow. The deployer becomes the owner/agent-underwriter and
    /// `min_risk_score` sets the acceptance bar (0-100 scale; notes with a risk score
    /// greater than or equal to this value are acceptable).
    pub fn init(&mut self, min_risk_score: u64) {
        self.owner.set(self.env().caller());
        self.min_risk_score.set(min_risk_score);
    }

    /// Opens a new receivable note. Owner (agent-underwriter) only.
    ///
    /// Reverts `NotOwner` if the caller is not the owner, `NoteExists` if a note
    /// with `note_id` already exists, and `RiskTooHigh` if `risk_score` is below
    /// the configured minimum.
    pub fn open_note(
        &mut self,
        note_id: u64,
        seller: Address,
        face_value: U512,
        risk_score: u64,
        risk_data_hash: String,
    ) {
        self.assert_owner();

        if self.notes.get(&note_id).is_some() {
            self.env().revert(Error::NoteExists);
        }
        if risk_score < self.min_risk_score.get_or_default() {
            self.env().revert(Error::RiskTooHigh);
        }

        self.notes.set(
            &note_id,
            Note {
                seller,
                investor: None,
                face_value,
                risk_score,
                risk_data_hash: risk_data_hash.clone(),
                status: 0,
            },
        );

        self.env().emit_event(NoteOpened {
            note_id,
            seller,
            face_value,
            risk_score,
            risk_data_hash,
        });
    }

    /// Funds an open note. The caller must attach exactly `face_value` in native
    /// tokens; the escrow forwards the full amount to the seller and records the
    /// caller as the investor.
    ///
    /// Reverts `NoNote` if no note exists for `note_id`, `AlreadyFunded` if the
    /// note is not in the `Open` state, and `WrongAmount` if the attached value
    /// does not equal the note's face value.
    #[odra(payable)]
    pub fn fund_note(&mut self, note_id: u64) {
        let mut note = self
            .notes
            .get(&note_id)
            .unwrap_or_revert_with(&self.env(), Error::NoNote);

        if note.status != 0 {
            self.env().revert(Error::AlreadyFunded);
        }

        let attached = self.env().attached_value();
        if attached != note.face_value {
            self.env().revert(Error::WrongAmount);
        }

        let investor = self.env().caller();
        note.investor = Some(investor);
        note.status = 1;
        self.notes.set(&note_id, note.clone());

        self.env().transfer_tokens(&note.seller, &note.face_value);

        self.env().emit_event(NoteFunded {
            note_id,
            investor,
            face_value: note.face_value,
            seller: note.seller,
        });
    }

    /// Marks a funded note as repaid. Owner only.
    ///
    /// Reverts `NoNote` if no note exists for `note_id` and `NotFunded` if the
    /// note has not been funded yet.
    pub fn mark_repaid(&mut self, note_id: u64) {
        self.assert_owner();

        let mut note = self
            .notes
            .get(&note_id)
            .unwrap_or_revert_with(&self.env(), Error::NoNote);

        if note.status != 1 {
            self.env().revert(Error::NotFunded);
        }

        note.status = 2;
        self.notes.set(&note_id, note);

        self.env().emit_event(NoteRepaid { note_id });
    }

    /// Returns the escrow owner (agent-underwriter).
    pub fn get_owner(&self) -> Address {
        self.owner.get_or_revert_with(Error::NotOwner)
    }

    /// Returns the configured minimum acceptable risk score.
    pub fn get_min_risk_score(&self) -> u64 {
        self.min_risk_score.get_or_default()
    }

    /// Returns the note for `note_id`, or `None` if it does not exist.
    pub fn get_note(&self, note_id: u64) -> Option<Note> {
        self.notes.get(&note_id)
    }

    fn assert_owner(&self) {
        if self.env().caller() != self.owner.get_or_revert_with(Error::NotOwner) {
            self.env().revert(Error::NotOwner);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Error, NoteFunded, NoteOpened, NoteRepaid, ReceivableEscrow, ReceivableEscrowHostRef,
        ReceivableEscrowInitArgs,
    };
    use odra::casper_types::U512;
    use odra::host::{Deployer, HostEnv, HostRef};

    const MIN_RISK_SCORE: u64 = 50;

    fn setup() -> (HostEnv, ReceivableEscrowHostRef) {
        let env = odra_test::env();
        env.set_caller(env.get_account(0));
        let contract = ReceivableEscrow::deploy(
            &env,
            ReceivableEscrowInitArgs {
                min_risk_score: MIN_RISK_SCORE,
            },
        );
        (env, contract)
    }

    #[test]
    fn init_sets_owner_and_min_risk_score() {
        let (env, contract) = setup();
        assert_eq!(contract.get_owner(), env.get_account(0));
        assert_eq!(contract.get_min_risk_score(), MIN_RISK_SCORE);
    }

    #[test]
    fn open_note_with_acceptable_risk_emits_event() {
        let (env, mut contract) = setup();
        let seller = env.get_account(1);
        let face_value = U512::from(10_000u64);

        env.set_caller(env.get_account(0));
        contract.open_note(1, seller, face_value, 80, "hash-1".to_string());

        assert!(env.emitted_event(
            &contract,
            NoteOpened {
                note_id: 1,
                seller,
                face_value,
                risk_score: 80,
                risk_data_hash: "hash-1".to_string(),
            }
        ));

        let note = contract.get_note(1).expect("note should exist");
        assert_eq!(note.seller, seller);
        assert_eq!(note.investor, None);
        assert_eq!(note.face_value, face_value);
        assert_eq!(note.risk_score, 80);
        assert_eq!(note.risk_data_hash, "hash-1".to_string());
        assert_eq!(note.status, 0);
    }

    #[test]
    fn open_note_reverts_when_risk_too_high() {
        let (env, mut contract) = setup();
        let seller = env.get_account(1);

        env.set_caller(env.get_account(0));
        assert_eq!(
            contract.try_open_note(2, seller, U512::from(1_000u64), 10, "hash-2".to_string()),
            Err(Error::RiskTooHigh.into())
        );
    }

    #[test]
    fn open_note_reverts_on_duplicate_note_id() {
        let (env, mut contract) = setup();
        let seller = env.get_account(1);

        env.set_caller(env.get_account(0));
        contract.open_note(3, seller, U512::from(1_000u64), 90, "hash-3".to_string());

        assert_eq!(
            contract.try_open_note(3, seller, U512::from(1_000u64), 90, "hash-3b".to_string()),
            Err(Error::NoteExists.into())
        );
    }

    #[test]
    fn open_note_reverts_for_non_owner() {
        let (env, mut contract) = setup();
        let seller = env.get_account(1);
        let non_owner = env.get_account(2);

        env.set_caller(non_owner);
        assert_eq!(
            contract.try_open_note(4, seller, U512::from(1_000u64), 90, "hash-4".to_string()),
            Err(Error::NotOwner.into())
        );
    }

    #[test]
    fn fund_note_with_correct_amount_pays_seller_and_emits_event() {
        let (env, mut contract) = setup();
        let seller = env.get_account(1);
        let investor = env.get_account(2);
        let face_value = U512::from(5_000u64);

        env.set_caller(env.get_account(0));
        contract.open_note(5, seller, face_value, 75, "hash-5".to_string());

        let seller_balance_before = env.balance_of(&seller);

        env.set_caller(investor);
        contract.with_tokens(face_value).fund_note(5);

        assert_eq!(env.balance_of(&seller), seller_balance_before + face_value);

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

    #[test]
    fn fund_note_reverts_on_wrong_amount() {
        let (env, mut contract) = setup();
        let seller = env.get_account(1);
        let investor = env.get_account(2);
        let face_value = U512::from(5_000u64);

        env.set_caller(env.get_account(0));
        contract.open_note(6, seller, face_value, 75, "hash-6".to_string());

        env.set_caller(investor);
        assert_eq!(
            contract.with_tokens(U512::from(4_999u64)).try_fund_note(6),
            Err(Error::WrongAmount.into())
        );
    }

    #[test]
    fn fund_note_reverts_when_already_funded() {
        let (env, mut contract) = setup();
        let seller = env.get_account(1);
        let investor = env.get_account(2);
        let second_investor = env.get_account(3);
        let face_value = U512::from(5_000u64);

        env.set_caller(env.get_account(0));
        contract.open_note(7, seller, face_value, 75, "hash-7".to_string());

        env.set_caller(investor);
        contract.with_tokens(face_value).fund_note(7);

        env.set_caller(second_investor);
        assert_eq!(
            contract.with_tokens(face_value).try_fund_note(7),
            Err(Error::AlreadyFunded.into())
        );
    }

    #[test]
    fn fund_note_reverts_for_missing_note() {
        let (env, mut contract) = setup();
        let investor = env.get_account(2);

        env.set_caller(investor);
        assert_eq!(
            contract
                .with_tokens(U512::from(1_000u64))
                .try_fund_note(999),
            Err(Error::NoNote.into())
        );
    }

    #[test]
    fn mark_repaid_after_funding_emits_event() {
        let (env, mut contract) = setup();
        let seller = env.get_account(1);
        let investor = env.get_account(2);
        let face_value = U512::from(2_500u64);

        env.set_caller(env.get_account(0));
        contract.open_note(8, seller, face_value, 60, "hash-8".to_string());

        env.set_caller(investor);
        contract.with_tokens(face_value).fund_note(8);

        env.set_caller(env.get_account(0));
        contract.mark_repaid(8);

        let note = contract.get_note(8).expect("note should exist");
        assert_eq!(note.status, 2);

        assert!(env.emitted_event(&contract, NoteRepaid { note_id: 8 }));
    }

    #[test]
    fn mark_repaid_reverts_when_not_funded() {
        let (env, mut contract) = setup();
        let seller = env.get_account(1);

        env.set_caller(env.get_account(0));
        contract.open_note(9, seller, U512::from(1_000u64), 60, "hash-9".to_string());

        assert_eq!(contract.try_mark_repaid(9), Err(Error::NotFunded.into()));
    }

    #[test]
    fn mark_repaid_reverts_for_missing_note() {
        let (env, mut contract) = setup();

        env.set_caller(env.get_account(0));
        assert_eq!(contract.try_mark_repaid(999), Err(Error::NoNote.into()));
    }
}
