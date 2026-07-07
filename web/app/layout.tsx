import { Inter, JetBrains_Mono } from "next/font/google";
import { WalletProvider } from "@/lib/wallet";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata = {
  title: "Invoice Factoring Agent",
  description:
    "Agentic invoice underwriting on Casper testnet: paid risk data, AI memo, on-chain open_note proof.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable}`}>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
