export interface ProofRecord {
  id: string;
  timestamp: string;
  invoiceId: string;
  debtorName: string;
  noteId: number;
  riskScore: number;
  deployHash: string;
  approved: boolean;
}

const STORAGE_KEY = "invoice-factoring-proofs";

export function loadProofs(): ProofRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProofRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProof(record: ProofRecord): void {
  const existing = loadProofs();
  const next = [record, ...existing.filter((p) => p.id !== record.id)];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, 50)));
}
