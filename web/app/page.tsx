import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-24">
      <section className="grid items-center gap-12 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-brass">Autonomous receivables</p>
          <h1 className="mt-5 max-w-[12ch] text-5xl font-semibold leading-[0.98] tracking-[-0.055em] text-ink md:text-7xl">
            Turn approved invoices into on-chain notes.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-ink-muted">
            The agent buys a signed risk report, stakes its own CSPR behind the score, and opens qualified receivables on Casper.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/desk" className="flex min-h-12 items-center rounded-desk bg-brass px-5 font-semibold text-desk-950 transition hover:bg-brass-bright">
              Underwrite an invoice
            </Link>
            <Link href="/ledger" className="flex min-h-12 items-center rounded-desk border border-desk-600 px-5 font-medium text-ink transition hover:bg-desk-800">
              Inspect decisions
            </Link>
          </div>
        </div>
        <aside className="rounded-[24px] border border-brass/30 bg-brass/10 p-8 shadow-raise">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-muted">Risk alignment</p>
          <strong className="mt-5 block text-4xl font-semibold tracking-[-0.04em] text-brass">Agent bond at risk</strong>
          <p className="mt-4 leading-7 text-ink-muted">
            Bad underwriting is not just logged. The signer has capital behind every score it submits.
          </p>
        </aside>
      </section>
      <section className="mt-24 grid gap-6 md:grid-cols-3">
        {[
          ["Buy", "Fetch a signed risk report through the paid data gate."],
          ["Decide", "Apply the minimum score and record accepted or refused paper."],
          ["Fund", "Open the receivable note and expose every deploy in the ledger."],
        ].map(([title, copy]) => (
          <article key={title} className="panel p-7 transition hover:-translate-y-0.5 hover:border-brass/40 hover:bg-desk-800">
            <h2 className="text-xl font-semibold text-ink">{title}</h2>
            <p className="mt-3 leading-7 text-ink-muted">{copy}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
