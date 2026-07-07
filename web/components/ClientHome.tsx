"use client";

import dynamic from "next/dynamic";

// The dashboard pulls in the wallet stack (window-dependent), so it is loaded
// client-only from this Client Component boundary.
const HomeDashboard = dynamic(() => import("@/components/HomeDashboard"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: "2rem", color: "var(--muted)" }}>Loading dashboard...</div>
  ),
});

export default function ClientHome() {
  return <HomeDashboard />;
}
