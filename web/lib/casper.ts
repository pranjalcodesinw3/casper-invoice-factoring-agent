import { Args, CLValue, ContractCallBuilder, Deploy, PublicKey } from "casper-js-sdk";

export const CHAIN_NAME = "casper-test";
export const OPEN_NOTE_PAYMENT_MOTES = 3_000_000_000;

export interface ContractOpenNoteArgs {
  note_id: number;
  seller: string;
  face_value_motes: string;
  risk_score: number;
  risk_data_hash: string;
}

export interface PreparedDeploy {
  deployJson: unknown;
  deployHashHex: string;
}

function normalizeContractHash(hash: string): string {
  return hash.replace(/^(hash-|contract-)/, "").trim();
}

export function buildOpenNoteDeploy(
  contractHash: string,
  callerPublicKeyHex: string,
  args: ContractOpenNoteArgs
): PreparedDeploy {
  const publicKey = PublicKey.fromHex(callerPublicKeyHex);
  const sellerKey = PublicKey.fromHex(args.seller);

  const runtimeArgs = Args.fromMap({
    note_id: CLValue.newCLUint64(args.note_id),
    seller: CLValue.newCLPublicKey(sellerKey),
    face_value: CLValue.newCLUInt512(args.face_value_motes),
    risk_score: CLValue.newCLUint64(args.risk_score),
    risk_data_hash: CLValue.newCLString(args.risk_data_hash),
  });

  const transaction = new ContractCallBuilder()
    .from(publicKey)
    .byHash(normalizeContractHash(contractHash))
    .entryPoint("open_note")
    .runtimeArgs(runtimeArgs)
    .chainName(CHAIN_NAME)
    .payment(OPEN_NOTE_PAYMENT_MOTES)
    .buildFor1_5();

  const deploy = transaction.getDeploy();
  if (!deploy) {
    throw new Error("casper-js-sdk did not produce a legacy deploy for open_note");
  }

  return {
    deployJson: Deploy.toJSON(deploy),
    deployHashHex: deploy.hash.toHex(),
  };
}

export function explorerDeployUrl(deployHashHex: string): string {
  return `https://testnet.cspr.live/deploy/${deployHashHex}`;
}

export function truncateHex(hex: string, lead = 8, tail = 6): string {
  if (hex.length <= lead + tail + 3) return hex;
  return `${hex.slice(0, lead)}...${hex.slice(-tail)}`;
}
