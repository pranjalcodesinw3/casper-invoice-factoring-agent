import ClientHome from "@/components/ClientHome";

// The home route is a client-rendered dashboard around a wallet session, so there
// is nothing to statically prerender; render it dynamically at request time.
export const dynamic = "force-dynamic";

export default function Home() {
  return <ClientHome />;
}
