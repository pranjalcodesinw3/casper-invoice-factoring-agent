"use client";

import { ReactNode } from "react";
import dynamic from "next/dynamic";

// Loading the CSPR.click wallet stack with `ssr: false` from inside a Client
// Component keeps the SDK (which touches `window` at module load) out of the
// server bundle entirely, so static prerendering of the layout never fails.
const WalletProvider = dynamic(
  () => import("@/lib/wallet").then((module) => module.WalletProvider),
  { ssr: false }
);

export default function Providers({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
