import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { publicConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Hedera Merchant Payments",
  description:
    "Non-custodial merchant payment gateway on Hedera: on-chain invoices, HTS/HBAR checkout, Mirror Node reconciliation and HCS receipts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-edge">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="h-2.5 w-2.5 rounded-full bg-acc" />
              Hedera Merchant Payments
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link href="/receipt" className="text-zinc-400 hover:text-zinc-100">
                Verify receipt
              </Link>
              <span className="rounded-md border border-edge px-2 py-1 text-xs text-zinc-400">
                network: {publicConfig.network}
              </span>
              <Link href="/new" className="rounded-md bg-acc px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90">
                New invoice
              </Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-5 pb-10 pt-4 text-xs text-zinc-500">
          Non-custodial by design: customer funds move straight to the merchant account. This app stores invoice
          metadata only — never private keys, never balances.
        </footer>
      </body>
    </html>
  );
}
