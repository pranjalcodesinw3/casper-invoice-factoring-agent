/* Copies the prover's own output into the web bundle at build time.
 *
 * The ledger on the landing page shows the SAME bytes the prover wrote, so the
 * page cannot drift into advertising a refusal that never happened. Falls back
 * to the committed copy on Vercel, where only web/ is uploaded, but still fails
 * loudly if there is no artifact and no fallback.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "PROOF.json");
const dest = join(here, "..", "lib", "proof.generated.json");

try {
  writeFileSync(dest, readFileSync(src, "utf8"));
  const n = JSON.parse(readFileSync(dest, "utf8")).steps?.length ?? 0;
  console.log(`synced proof: ${n} on-chain steps -> lib/proof.generated.json`);
} catch (err) {
  if (existsSync(dest)) {
    console.log(`PROOF.json not present (${err.code}); keeping committed copy`);
    process.exit(0);
  }
  throw new Error(`no proof artifact and no committed fallback: ${err.message}`);
}
