"use client";
import { Button } from "@/components/ui/button";

/** Visible conflict (spec 4.3): shows both values; never a silent overwrite. */
export function ConflictNotice({ mine, current, fields, onKeepTheirs, onApplyMine }: { mine: Record<string, unknown>; current: Record<string, unknown> | null | undefined; fields: string[]; onKeepTheirs: () => void; onApplyMine: () => void }) {
  const changed = fields.filter((f) => String(mine[f] ?? "") !== String(current?.[f] ?? ""));
  return (
    <div role="alert" className="rounded-[12px] border border-bad/50 bg-[#fbeceb] p-4 text-sm">
      <p className="font-semibold text-bad">Someone else saved this record while you were editing{current?.updated_by ? ` (${String(current.updated_by)})` : ""}.</p>
      {changed.length ? (
        <table className="mt-3 w-full text-left text-[13px]">
          <thead><tr className="text-text-2"><th className="font-medium">Field</th><th className="font-medium">Yours</th><th className="font-medium">Saved now</th></tr></thead>
          <tbody>
            {changed.map((f) => (
              <tr key={f} className="border-t border-bad/20 align-top"><td className="py-1 pr-2">{f.replace(/_/g, " ")}</td><td className="py-1 pr-2">{String(mine[f] ?? "—")}</td><td className="py-1">{String(current?.[f] ?? "—")}</td></tr>
            ))}
          </tbody>
        </table>
      ) : <p className="mt-2 text-text-2">The other change touched different fields.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onKeepTheirs}>Keep saved version</Button>
        <Button size="sm" variant="dark" onClick={onApplyMine}>Apply mine on top</Button>
      </div>
    </div>
  );
}
