import type { Metadata } from "next";
import ClientHome from "@/components/ClientHome";

export const metadata: Metadata = {
  title: "Invoice Factoring Agent: underwriting desk",
  description:
    "Post an underwriter bond and let the agent score a receivable on chain.",
};


export const dynamic = "force-dynamic";

export default function DeskPage() {
  return <ClientHome />;
}
