const STYLES: Record<string, string> = {
  OPEN: "border-acc/40 bg-acc/10 text-acc",
  SETTLED: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  CANCELLED: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
  EXPIRED: "border-warn/40 bg-warn/10 text-warn",
};

export default function StatusBadge({ status }: { status: string }) {
  const cls = STYLES[status] ?? STYLES.CANCELLED;
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${cls}`}>
      {status}
    </span>
  );
}
