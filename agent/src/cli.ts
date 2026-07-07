import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { runUnderwriting } from "./agent";
import { Invoice } from "./underwriting";

dotenv.config();

const invoicesFile = path.join(__dirname, "invoices.json");
const invoicesData = JSON.parse(fs.readFileSync(invoicesFile, "utf-8"));

async function main() {
  const scenario = process.argv[2];

  if (!scenario || !["good", "risky"].includes(scenario)) {
    console.error("Usage: tsx src/cli.ts [good|risky]");
    process.exit(1);
  }

  const invoiceData = invoicesData.invoices[scenario];
  if (!invoiceData) {
    console.error(`Invoice scenario '${scenario}' not found`);
    process.exit(1);
  }

  const invoice: Invoice = invoiceData;
  const debtorId = scenario === "good" ? "acme_corp" : "startup_tech";

  console.log(`\n========== Invoice Factoring Agent CLI ==========\n`);
  console.log(`Scenario: ${scenario.toUpperCase()}`);
  console.log(`Invoice: ${invoice.invoice_id}`);
  console.log(`Debtor: ${invoice.debtor_name}`);
  console.log(`Face Value: $${invoice.face_value}`);
  console.log(`Days Overdue: ${invoice.days_overdue}`);
  console.log(`\n================================================\n`);

  try {
    const result = await runUnderwriting(invoice, debtorId, 50);

    console.log(`\n--- Risk Report ---`);
    console.log(`Debtor: ${result.riskReport.debtor}`);
    console.log(`Risk Score: ${result.riskReport.riskScore}/100`);
    console.log(`Factors: ${result.riskReport.factors.join(", ")}`);
    console.log(`Signature Valid: ${result.dataSignatureValid}`);

    console.log(`\n--- Underwriting Decision ---`);
    console.log(`Approved: ${result.decision.approved}`);
    console.log(`Funding Amount: $${result.decision.fundingAmount}`);
    console.log(`Advance Rate: ${(result.decision.recommendedAdvanceRate * 100).toFixed(1)}%`);
    console.log(`\nReasons:`);
    result.decision.reasons.forEach((r) => console.log(`  - ${r}`));

    console.log(`\n--- AI Underwriting Memo ---`);
    console.log(result.decision.memo);

    if (result.noteArgs) {
      console.log(`\n--- Contract Note Args (for open_note) ---`);
      console.log(JSON.stringify(result.noteArgs, null, 2));
    }

    console.log(`\n================================================\n`);

    // Exit with success
    process.exit(0);
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

main();
