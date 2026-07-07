//! `odra-cli` entrypoint for deploying and interacting with `ReceivableEscrow`.
//!
//! Build the CLI binary with `cargo build --bin receivable_escrow_cli` and run it
//! with `--help` to see the deploy and scenario commands.

use odra::host::HostEnv;
use odra_cli::{
    deploy::DeployScript, ContractProvider, DeployedContractsContainer, DeployerExt, OdraCli,
};
use receivable_escrow::receivable_escrow::{ReceivableEscrow, ReceivableEscrowInitArgs};

/// Minimum acceptable underwriting risk score (0-100 scale) for the deployed escrow.
/// Notes with a risk score below this bar are rejected by `open_note`.
const MIN_RISK_SCORE: u64 = 50;

/// Deploys `ReceivableEscrow` and registers it in the deployed-contracts container.
pub struct ReceivableEscrowDeployScript;

impl DeployScript for ReceivableEscrowDeployScript {
    fn deploy(
        &self,
        env: &HostEnv,
        container: &mut DeployedContractsContainer,
    ) -> Result<(), odra_cli::deploy::Error> {
        let _escrow = ReceivableEscrow::load_or_deploy(
            env,
            ReceivableEscrowInitArgs {
                min_risk_score: MIN_RISK_SCORE,
            },
            container,
            350_000_000_000, // gas limit in motes; adjust for the target network
        )?;
        Ok(())
    }
}

/// Main function to run the CLI tool.
pub fn main() {
    OdraCli::new()
        .about("CLI tool for the ReceivableEscrow smart contract")
        .deploy(ReceivableEscrowDeployScript)
        .contract::<ReceivableEscrow>()
        .build()
        .run();
}
