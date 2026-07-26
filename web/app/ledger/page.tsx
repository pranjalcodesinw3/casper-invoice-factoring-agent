import DecisionLedger from "@/components/DecisionLedger";

export default function LedgerPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
      <header className="mb-10 max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-brass">Chain receipts</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-ink md:text-6xl">Every decision, including the refusals.</h1>
        <p className="mt-5 text-lg leading-8 text-ink-muted">Accepted and rejected notes appear with their Casper deploys and typed contract outcomes.</p>
      </header>
      <DecisionLedger />
    </main>
  );
}
