import Link from "next/link";

export default function ProductNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-desk-700 bg-desk-950/90 backdrop-blur-xl">
      <nav className="mx-auto flex min-h-[68px] max-w-7xl items-center gap-3 px-6 lg:px-8" aria-label="Primary navigation">
        <Link href="/" className="mr-auto text-base font-semibold tracking-[-0.02em] text-ink">
          Factorline
        </Link>
        <Link href="/" className="flex min-h-10 items-center rounded-desk px-3 text-sm text-ink-muted transition hover:bg-desk-800 hover:text-ink">
          Overview
        </Link>
        <Link href="/ledger" className="flex min-h-10 items-center rounded-desk px-3 text-sm text-ink-muted transition hover:bg-desk-800 hover:text-ink">
          Ledger
        </Link>
        <Link href="/desk" className="ml-2 flex min-h-10 items-center rounded-desk bg-brass px-4 text-sm font-semibold text-desk-950 transition hover:bg-brass-bright">
          Open desk
        </Link>
      </nav>
    </header>
  );
}
