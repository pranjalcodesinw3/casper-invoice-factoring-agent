export interface NoteArgs {
  /** Agent-side note identifier; mapped to u64 on-chain via hash. */
  note_id: string;
  /** Human-readable supplier/debtor label from the invoice (not a chain address). */
  seller: string;
  /** Invoice face value in USD for display; advance uses decision.fundingAmount. */
  face_value: number;
  risk_score: number;
  risk_data_hash: string;
}
