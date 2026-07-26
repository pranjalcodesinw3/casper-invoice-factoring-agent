import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import ProductNav from "@/components/ProductNav";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Invoice Factoring Agent",
  description:
    "An agentic underwriter that pays a data endpoint for a signed risk report, decides whether to advance an invoice, and opens the receivable note on-chain on Casper testnet.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable}`}>
        <Providers>
          <ProductNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
