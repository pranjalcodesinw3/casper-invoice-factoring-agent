/**
 * Native CSPR transfer between two testnet accounts we control.
 *
 * Needed because the invoice-factoring account hit 0 CSPR: an Odra `payable`
 * entrypoint can only be funded through a session-wasm proxy deploy, and Casper
 * charges the FULL payment (attached value + proxy gas, ~21 CSPR) rather than
 * the gas actually burned. Three of those drained the account.
 *
 * Usage:
 *   FROM_SECRET_KEY_PATH=... TO_PUBLIC_KEY_HEX=... AMOUNT_CSPR=60 npx tsx transfer.ts
 */
import fs from "fs";
import * as casperSdk from "casper-js-sdk";

const { HttpHandler, KeyAlgorithm, PrivateKey, PublicKey, RpcClient, NativeTransferBuilder } =
  casperSdk as any;

const NODE_URL = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const CHAIN = "casper-test";
/** Native transfers are a fixed 0.1 CSPR on Casper 2.x. */
const TRANSFER_FEE_MOTES = 100_000_000;

async function main() {
  const from = process.env.FROM_SECRET_KEY_PATH;
  const to = process.env.TO_PUBLIC_KEY_HEX;
  const amountCspr = process.env.AMOUNT_CSPR;
  if (!from || !to || !amountCspr) {
    throw new Error("FROM_SECRET_KEY_PATH, TO_PUBLIC_KEY_HEX and AMOUNT_CSPR are required");
  }

  const priv = PrivateKey.fromPem(fs.readFileSync(from, "utf8"), KeyAlgorithm.ED25519);
  const motes = (BigInt(amountCspr) * 1_000_000_000n).toString();

  const deploy = new NativeTransferBuilder()
    .from(PublicKey.fromHex(priv.publicKey.toHex()))
    .target(PublicKey.fromHex(to))
    .amount(motes)
    // Casper requires a transfer id; without it the deploy is rejected as invalid.
    .id(Date.now())
    .chainName(CHAIN)
    .payment(TRANSFER_FEE_MOTES)
    // buildFor1_5() yields a Transaction wrapper; putDeploy needs the legacy
    // Deploy inside it, otherwise the RPC rejects with "missing field `deploy`".
    .buildFor1_5()
    .getDeploy();
  if (!deploy) throw new Error("sdk did not produce a legacy deploy");
  deploy.sign(priv);

  const client = new RpcClient(new HttpHandler(NODE_URL));
  const res = await client.putDeploy(deploy);
  const hash = typeof res.deployHash === "string" ? res.deployHash : deploy.hash.toHex();
  console.log(`transfer ${amountCspr} CSPR -> ${hash}`);

  // Poll to completion: reporting a hash that later failed would be worse than
  // waiting, since the caller's next step depends on the funds landing.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const body = await fetch(NODE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "info_get_deploy",
        params: { deploy_hash: hash },
      }),
    }).then((r) => r.json() as any);
    const result = body.result?.execution_info?.execution_result;
    if (!result) continue;
    const err = (result.Version2 ?? result.Version1 ?? result).error_message;
    console.log(err ? `FAILED: ${err}` : "transfer executed OK");
    process.exit(err ? 1 : 0);
  }
  throw new Error("timed out waiting for the transfer");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
