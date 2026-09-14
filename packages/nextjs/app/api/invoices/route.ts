import { NextResponse } from "next/server";
import { z } from "zod";
import { AmountError, InvoiceRuleError } from "@hmp/ledger";
import { createInvoice, loadInvoices } from "@/lib/invoices";
import { hasDatabase, publicConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  amount: z.union([z.string().min(1), z.number()]),
  token: z.string().optional(),
  ttlMinutes: z.number().int().min(1).max(60 * 24 * 30).optional(),
});

export async function GET() {
  const state = await loadInvoices();
  if (!state.ok) {
    return NextResponse.json({ ok: false, error: state.reason, configured: hasDatabase() }, { status: 503 });
  }
  return NextResponse.json({ ok: true, invoices: state.invoices, config: { network: publicConfig.network } });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }

  try {
    const result = await createInvoice(parsed.data);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, invoice: result.invoice }, { status: 201 });
  } catch (error) {
    // Amount/rule validation from @hmp/ledger surfaces as a clean 400, not a stack trace.
    if (error instanceof AmountError || error instanceof InvoiceRuleError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    throw error;
  }
}
