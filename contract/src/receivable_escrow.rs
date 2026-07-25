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

use crate::underwriter_bond::{Bond, NoteDefaulted, UnderwriterBond};

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

    // 20+ : the underwriter bond. Codes 1-7 above are FROZEN because
    // PROOF.json cites them and the agent switches on them.
    /// A bond of zero was posted; there is nothing to stake.
    ZeroBond = 20,
    /// The underwriter has not staked the minimum bond.
    NotBonded = 21,
    /// A withdrawal asked for more collateral than is held.
    BondTooSmall = 22,
    /// The underwriter holds no bond at all, so there is nothing to slash.
    NoBond = 23,
    /// This note has already been declared in default. Defence in depth only:
    /// `NotDefaultable` fires first on every path that exists today, so this
    /// code is currently unreachable and is not claimed as a proven guard.
    AlreadyDefaulted = 24,
    /// Only a funded note can default; an open note has nobody to repay.
    NotDefaultable = 25,
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
    /// The underwriter's collateral. A SubModule so the bond's invariants live
    /// in one file and can be tested without opening a note.
    bond: SubModule<UnderwriterBond>,
}

#[odra::module]
impl ReceivableEscrow {
    /// Initializes the escrow. The deployer becomes the owner/agent-underwriter and
    /// `min_risk_score` sets the acceptance bar (0-100 scale; notes with a risk score
    /// greater than or equal to this value are acceptable).
    pub fn init(&mut self, min_risk_score: u64, min_bond: U512) {
        self.owner.set(self.env().caller());
        self.min_risk_score.set(min_risk_score);
        self.bond.init(min_bond);
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

        // The bond is what makes the risk score cost something. An underwriter
        // that has not staked the minimum cannot open notes at all, so the
        // collateral is a precondition of underwriting rather than a badge
        // displayed beside it.
        if !self.bond.is_bonded(self.env().caller()) {
            self.env().revert(Error::NotBonded);
        }

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

    // ---- underwriter bond -------------------------------------------------

    /// Stakes collateral against the notes this underwriter opens.
    ///
    /// Payable: the attached CSPR moves into the contract's purse and stays
    /// there until it is withdrawn or slashed. That is what separates this from
    /// a bond that is only an entry in a table.
    #[odra(payable)]
    pub fn post_bond(&mut self) {
        let amount = self.env().attached_value();
        let underwriter = self.env().caller();
        self.bond.post_bond(underwriter, amount);
    }

    /// Returns unslashed collateral to the underwriter who staked it.
    pub fn withdraw_bond(&mut self, amount: U512) {
        let underwriter = self.env().caller();
        let released = self.bond.withdraw(underwriter, amount);
        self.env().transfer_tokens(&underwriter, &released);
    }

    /// Declares a funded note to be in default and pays the investor from the
    /// underwriter's bond.
    ///
    /// Owner-only, and that is the honest boundary of this mechanism: a
    /// contract cannot observe that an invoice went unpaid in the real world.
    /// What it does enforce is everything after the declaration. Only a funded
    /// note can default (`NotDefaultable`, which also makes a replay impossible), the
    /// payout is capped by what was actually staked, and the money goes to the
    /// note's recorded investor rather than to whoever asked.
    pub fn declare_default(&mut self, note_id: u64) {
        self.assert_owner();

        let mut note = self
            .notes
            .get(&note_id)
            .unwrap_or_revert_with(&self.env(), Error::NoNote);

        // Status 1 is Funded. An open note has no investor to repay, and a
        // repaid note has already settled.
        if note.status != 1 {
            self.env().revert(Error::NotDefaultable);
        }

        let investor = note
            .investor
            .unwrap_or_revert_with(&self.env(), Error::NotDefaultable);
        let underwriter = self.owner.get_or_revert_with(Error::NotOwner);

        let face_value = note.face_value;
        let paid = self.bond.slash(note_id, underwriter, face_value);

        // Status 3 is Defaulted. Set before the transfer so a reentrant token
        // hook cannot re-enter against a note that still looks funded.
        note.status = 3;
        self.notes.set(&note_id, note);

        self.env().transfer_tokens(&investor, &paid);

        self.env().emit_event(NoteDefaulted {
            note_id,
            underwriter,
            investor,
            paid,
            face_value,
        });
    }

    /// The collateral currently staked by `underwriter`, plus its slash history.
    pub fn get_bond(&self, underwriter: Address) -> Bond {
        self.bond.get_bond(underwriter)
    }

    /// The minimum bond an underwriter must hold to open notes.
    pub fn min_bond(&self) -> U512 {
        self.bond.min_bond()
    }

    /// True once `underwriter` has staked at least the minimum.
    pub fn is_bonded(&self, underwriter: Address) -> bool {
        self.bond.is_bonded(underwriter)
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
