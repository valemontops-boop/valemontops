"use client";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Modal used only for protected focus (Quick Action). Bottom sheet on phones, centered on larger screens. */
export function Modal({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <D.Content
          className={cn(
            "fixed z-50 flex max-h-[92dvh] flex-col overflow-hidden bg-panel shadow-[0_12px_40px_rgba(23,22,26,0.18)] focus:outline-none",
            "inset-x-0 bottom-0 rounded-t-[20px] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[8vh] sm:-translate-x-1/2 sm:rounded-[20px]",
            wide ? "sm:w-[720px]" : "sm:w-[560px]",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
            <div>
              <D.Title className="text-lg font-semibold tracking-tight">{title}</D.Title>
              {description ? <D.Description className="text-sm text-text-2">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="rounded-full p-2 text-text-2 hover:bg-subtle" aria-label="Close">
              <X className="size-5" />
            </D.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Right-hand detail panel: keeps the list visible on desktop, full screen on phones. */
export function DetailPanel({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <aside
      aria-label="Details"
      className="fixed inset-0 z-30 flex flex-col bg-panel lg:sticky lg:top-4 lg:inset-auto lg:z-auto lg:h-[calc(100dvh-2rem)] lg:w-[420px] lg:shrink-0 lg:rounded-[20px] lg:shadow-[0_8px_30px_rgba(23,22,26,0.08)]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
        <div className="min-w-0 flex-1">{title}</div>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded-full p-2 text-text-2 hover:bg-subtle">
          <X className="size-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer ? <div className="border-t border-hairline px-5 py-3">{footer}</div> : null}
    </aside>
  );
}
