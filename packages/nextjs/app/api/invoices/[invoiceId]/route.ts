import { NextResponse } from "next/server";
import { cancelInvoice, loadInvoice } from "@/lib/invoices";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ invoiceId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { invoiceId } = await params;
  const invoice = await loadInvoice(invoiceId);
  if (!invoice) return NextResponse.json({ ok: false, error: "invoice not found" }, { status: 404 });
  return NextResponse.json({ ok: true, invoice });
}

/** Merchant-side cancellation of an open invoice (the registry allows this on-chain too). */
export async function DELETE(_request: Request, { params }: Context) {
  const { invoiceId } = await params;
  const result = await cancelInvoice(invoiceId);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.reason }, { status: 400 });
  const invoice = await loadInvoice(invoiceId);
  return NextResponse.json({ ok: true, invoice });
}
