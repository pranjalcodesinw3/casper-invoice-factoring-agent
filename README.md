# Invoice Factoring Agent

Turn an unpaid invoice into a funded receivable note with agentic underwriting.

## User

Small suppliers that need faster payment and investors that want short-duration receivable exposure.

## Problem

RWA invoice finance requires document review, debtor risk checks, funding escrow, and repayment tracking. Current hackathon projects often stop at a risk score or hash.

## Solution

An agent reviews invoice data, buys or simulates paid risk data through an x402-style endpoint, mints a receivable note on Casper, and routes funding through escrow.

## Casper primitives

Odra receivable escrow, x402 paid risk API, CSPR.cloud receipt timeline, AI underwriting agent.

## Demo wow

Upload invoice, agent pays for risk data, contract opens funding round, investor funds, seller receives testnet CSPR.

## MVP scope

Invoice form, risk endpoint, note registry, escrow funding, repayment marker, proof page.

## Main risk

Off-chain invoice truth. MVP must frame data as demo attestation, not real credit decision.
