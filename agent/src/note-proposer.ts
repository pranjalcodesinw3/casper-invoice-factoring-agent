/**
 * Builds a real `open_note` deploy for the escrow owner to sign.
 *
 * The agent never holds a key and never broadcasts. It produces a deploy the
 * owner signs in their wallet, which is why this returns a deploy hash rather
 * than a transaction hash: nothing has hit the chain yet, and claiming
 * otherwise would be a faked tx hash.
 */
import {
  buildOpenNoteDeploy,
  type ContractOpenNoteArgs,
} from "./contract-client.js";
import type { NoteProposer } from "./underwriting-tools.js";

export class DeployNoteProposer implements NoteProposer {
  constructor(
    private readonly contractHash: string,
    /** The escrow owner's public key. Only the owner may call open_note. */
    private readonly ownerPublicKeyHex: string
  ) {
    if (!contractHash) {
      throw new Error("DeployNoteProposer requires a contract hash");
    }
    if (!ownerPublicKeyHex) {
      throw new Error(
        "DeployNoteProposer requires the escrow owner public key; open_note reverts NotOwner for anyone else"
      );
    }
  }

  /** The last deploy built, so a server can hand it to the wallet to sign. */
  lastDeployJson: unknown = null;

  async proposeOpenNote(params: {
    noteId: string;
    sellerPublicKeyHex: string;
    faceValueMotes: string;
    riskScore: number;
    riskDataHash: string;
  }): Promise<{ prepared: boolean; deployHashHex: string | null; note: string }> {
    const args: ContractOpenNoteArgs = {
      note_id: Number(params.noteId),
      seller: params.sellerPublicKeyHex,
      face_value_motes: params.faceValueMotes,
      risk_score: params.riskScore,
      risk_data_hash: params.riskDataHash,
    };

    try {
      const prepared = buildOpenNoteDeploy(
        this.contractHash,
        this.ownerPublicKeyHex,
        args
      );
      this.lastDeployJson = prepared.deployJson;
      return {
        prepared: true,
        deployHashHex: prepared.deployHashHex,
        note:
          `unsigned open_note deploy built for note ${params.noteId}; ` +
          `the escrow owner must sign it before it reaches the chain`,
      };
    } catch (err) {
      // A build failure is information the agent should reason about, not a
      // reason to claim a deploy exists.
      return {
        prepared: false,
        deployHashHex: null,
        note: `could not build the deploy: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }
}
