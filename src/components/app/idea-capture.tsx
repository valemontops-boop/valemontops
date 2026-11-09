"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useT } from "@/i18n/react";

/** Capture in under 5 seconds: one line, Enter, done. It never touches today's targets. */
export function IdeaCapture({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("New idea")} description={t("One line is enough. It is parked in the Idea Box and adds nothing to today.")}>
      <IdeaForm onDone={() => onOpenChange(false)} />
    </Modal>
  );
}

function IdeaForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const t = useT();
  const [id] = React.useState(() => crypto.randomUUID());
  const [text, setText] = React.useState("");
  const m = useMutation({
    mutationFn: () => api("/api/ideas", { body: { id, text } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ideas"] }); toast(t("Idea saved")); onDone(); },
  });
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) m.mutate(); }}>
      <Input aria-label={t("Idea")} autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={t("e.g. Offer garages a 14-day pilot")} />
      <Button type="submit" variant="primary" disabled={!text.trim() || m.isPending}>{m.isPending ? t("Saving…") : m.isError ? t("Retry") : t("Save")}</Button>
    </form>
  );
}
