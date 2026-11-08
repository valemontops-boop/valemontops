import * as React from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-[12px] border border-control bg-panel px-3 text-[15px] text-ink placeholder:text-text-3 focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(control, "h-10", className)} {...p} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(control, "min-h-20 py-2", className)} {...p} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn(control, "h-10 appearance-auto pr-2", className)} {...p} />
));
Select.displayName = "Select";

export function Field({ label, htmlFor, hint, error, children, className }: { label: string; htmlFor: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-text-2">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[13px] text-bad">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-text-3">{hint}</p>
      ) : null}
    </div>
  );
}

export function Panel({ className, children, ...p }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("rounded-[20px] bg-panel p-5 sm:p-6", className)} {...p}>
      {children}
    </section>
  );
}

export function PanelTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

export function SegmentedSwitch<T extends string>({ value, onChange, options, label, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-subtle p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full font-medium transition-colors duration-150",
            size === "sm" ? "h-7 px-3 text-[13px]" : "h-8 px-4 text-sm",
            value === o.value ? "bg-panel text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-text-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[12px] border border-dashed border-hairline p-5">
      <p className="font-medium">{title}</p>
      {children ? <div className="text-sm text-text-2">{children}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong";
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[12px] border border-bad/40 bg-[#fbeceb] p-4 text-sm text-bad">
      <span>Error: {msg}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-[12px] bg-subtle", className)} />;
}
