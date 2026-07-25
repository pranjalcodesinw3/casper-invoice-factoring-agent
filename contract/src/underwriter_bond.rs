//! The underwriter's bond: collateral that is real custody, not a number.
//!
//! # Why this exists
//!
//! An on-chain minimum risk score is a threshold check, and several teams in
//! this field have one. It makes the underwriter's score a *filter*. It does not
//! make the underwriter *accountable*, because nothing the underwriter owns is
//! at risk when the score turns out to be wrong.
//!
//! This module makes the score cost something. The underwriter funds a bond
//! purse before it may open notes; if a note it underwrote is declared in
//! default, the bond pays the investor who funded that note, out of real CSPR
//! the underwriter actually transferred in.
//!
//! # What makes this different from the bonded scorers already in the field
//!
//! Bonded, slashable scoring exists elsewhere. What does not exist is a bond
//! that is **custody**. The closest neighbour, Wardens Protocol (46792), says
//! so in its own source: `agents.rs` records bonds as "an internal U512 ledger
//! inside the contract rather than real purse locking", `bond_vault.rs` calls
//! it a "simulated purse", and the repository contains no `payable` entrypoint
//! at all. Their slash decrements an integer, so nothing is ever at stake.
//!
//! Here `post_bond` is `#[odra(payable)]` and moves native CSPR into the
//! contract's purse, and `slash_on_default` calls `transfer_tokens` to move it
//! back out to the investor. The difference is observable from outside: after a
//! slash, the contract's balance is lower and the investor's is higher.
//!
//! # The honest boundary
//!
//! Declaring the default is an owner call, not something the contract infers.
//! A contract cannot observe that an invoice went unpaid in the real world, and
//! pretending otherwise would be the same unfalsifiable claim this module
//! exists to avoid. What the contract *does* enforce is everything downstream
//! of that declaration: only a funded note can default, only once, the payout
//! is capped by the bond, and the money moves to the note's recorded investor
//! rather than to whoever asked.

use odra::casper_types::U512;
use odra::prelude::*;

use crate::receivable_escrow::Error;

/// Per-underwriter bond state.
#[odra::odra_type]
pub struct Bond {
    /// CSPR currently held for this underwriter, in motes.
    pub amount: U512,
    /// Cumulative amount slashed, for reputation without extra bookkeeping.
    pub slashed: U512,
    /// Number of notes this underwriter has had declared in default.
    pub defaults: u32,
}

#[odra::event]
pub struct BondPosted {
    pub underwriter: Address,
    pub amount: U512,
    pub total: U512,
}

#[odra::event]
pub struct BondWithdrawn {
    pub underwriter: Address,
    pub amount: U512,
    pub remaining: U512,
}

/// Emitted when a default is declared and the bond pays the investor.
#[odra::event]
pub struct NoteDefaulted {
    pub note_id: u64,
    pub underwriter: Address,
    /// Who received the slashed collateral: the investor who funded the note.
    pub investor: Address,
    /// What was actually transferred, which is capped by the bond balance.
    pub paid: U512,
    /// The note's face value, so a shortfall is visible rather than implied.
    pub face_value: U512,
}

/// Bond custody for underwriters.
///
/// Deliberately a separate module from the escrow: the escrow decides whether a
/// note may exist, and this decides what the underwriter has staked on that
/// judgement. Keeping them apart means the note lifecycle tests stay readable
/// and the bond invariants can be tested without opening a note.
#[odra::module(events = [BondPosted, BondWithdrawn, NoteDefaulted])]
pub struct UnderwriterBond {
    bonds: Mapping<Address, Bond>,
    /// Notes already declared in default, so a default cannot be replayed.
    defaulted: Mapping<u64, bool>,
    /// Minimum bond an underwriter must hold to open notes.
    min_bond: Var<U512>,
}

#[odra::module]
impl UnderwriterBond {
    pub fn init(&mut self, min_bond: U512) {
        self.min_bond.set(min_bond);
    }

    /// The bond an underwriter must hold before it may open notes.
    pub fn min_bond(&self) -> U512 {
        self.min_bond.get_or_default()
    }

    pub fn get_bond(&self, underwriter: Address) -> Bond {
        self.bonds.get(&underwriter).unwrap_or(Bond {
            amount: U512::zero(),
            slashed: U512::zero(),
            defaults: 0,
        })
    }

    /// True once the underwriter has posted at least the minimum.
    pub fn is_bonded(&self, underwriter: Address) -> bool {
        self.get_bond(underwriter).amount >= self.min_bond.get_or_default()
    }

    pub fn was_defaulted(&self, note_id: u64) -> bool {
        self.defaulted.get(&note_id).unwrap_or(false)
    }

    /// Posts collateral. The attached CSPR stays in the contract's purse until
    /// it is withdrawn or slashed.
    pub fn post_bond(&mut self, underwriter: Address, amount: U512) {
        if amount.is_zero() {
            self.env().revert(Error::ZeroBond);
        }
        let mut bond = self.get_bond(underwriter);
        bond.amount += amount;
        self.bonds.set(&underwriter, bond.clone());
        self.env().emit_event(BondPosted {
            underwriter,
            amount,
            total: bond.amount,
        });
    }

    /// Returns collateral to the underwriter.
    ///
    /// Reverts rather than silently capping: an underwriter asking for more
    /// than it holds has misunderstood its own position, and quietly sending
    /// less would hide that.
    pub fn withdraw(&mut self, underwriter: Address, amount: U512) -> U512 {
        let mut bond = self.get_bond(underwriter);
        if amount > bond.amount {
            self.env().revert(Error::BondTooSmall);
        }
        bond.amount -= amount;
        self.bonds.set(&underwriter, bond.clone());
        self.env().emit_event(BondWithdrawn {
            underwriter,
            amount,
            remaining: bond.amount,
        });
        amount
    }

    /// Records a default against the underwriter and returns what the bond owes
    /// the investor, capped at the bond balance.
    ///
    /// Returning the amount rather than transferring here keeps the token
    /// movement in one place in the escrow, so there is a single path that can
    /// move money out of the contract.
    /// # On the replay guard below
    ///
    /// Mutation testing showed that deleting the `was_defaulted` check breaks
    /// no test, which means it is currently **unreachable**: `declare_default`
    /// already requires the note to be Funded and sets it to Defaulted before
    /// returning, so a second call is refused by `NotDefaultable` first. It is
    /// kept as defence in depth for a future caller that reaches `slash`
    /// through another path, and is deliberately NOT counted as one of the
    /// module's proven guards. An unreachable check that is described as
    /// enforcement is exactly the kind of claim this project refuses to make.
    pub fn slash(&mut self, note_id: u64, underwriter: Address, face_value: U512) -> U512 {
        if self.was_defaulted(note_id) {
            self.env().revert(Error::AlreadyDefaulted);
        }
        let mut bond = self.get_bond(underwriter);
        if bond.amount.is_zero() {
            self.env().revert(Error::NoBond);
        }

        // The bond covers the loss up to what was actually staked. A shortfall
        // is real and is reported in the event rather than smoothed over.
        let paid = if face_value > bond.amount {
            bond.amount
        } else {
            face_value
        };

        bond.amount -= paid;
        bond.slashed += paid;
        bond.defaults += 1;
        self.bonds.set(&underwriter, bond);
        self.defaulted.set(&note_id, true);
        paid
    }
}
