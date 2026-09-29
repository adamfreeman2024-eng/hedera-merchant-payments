import { redirect } from "next/navigation";
import { publicConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Shareable URL: /receipt/INV-… → same reconstruct as /receipt?id= */
export default async function InvoiceReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ topic?: string }>;
}) {
  const { invoiceId } = await params;
  const q = await searchParams;
  const topic = (q.topic || publicConfig.hcsTopicId || "").trim();
  const sp = new URLSearchParams();
  if (topic) sp.set("topic", topic);
  sp.set("id", invoiceId);
  redirect(`/receipt?${sp.toString()}`);
}
