"use client";
import * as React from "react";
import { useT } from "@/i18n/react";

/** Copies a value the page computed itself (generated secret, address, redirect URI). Never a configured secret. */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <code aria-label={label} className="min-w-0 flex-1 break-all rounded-[10px] bg-subtle px-3 py-2 text-[13px]">{value}</code>
      <button
        type="button"
        className="h-9 rounded-full border border-control px-4 text-[13px] font-medium hover:bg-subtle"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? t("Copied") : t("Copy")}
      </button>
    </div>
  );
}

/** SESSION_SECRET generator: 48 random bytes from the browser (crypto.getRandomValues), never sent anywhere. */
export function SecretGenerator() {
  const t = useT();
  const [value, setValue] = React.useState("");
  const generate = () => {
    const bytes = new Uint8Array(48);
    crypto.getRandomValues(bytes);
    setValue(btoa(String.fromCharCode(...bytes)));
  };
  return (
    <div className="mt-3">
      <button type="button" onClick={generate} className="h-10 rounded-full bg-accent px-5 text-sm font-medium text-on-accent hover:bg-accent-hover">
        {value ? t("Generate another") : t("Generate a secret")}
      </button>
      {value ? (
        <>
          <CopyValue value={value} label="SESSION_SECRET" />
          <p className="mt-1 text-[12px] text-text-3">{t("Generated in this browser only; it is not sent or saved anywhere. Paste it in Vercel now: it disappears when you leave the page.")}</p>
        </>
      ) : null}
    </div>
  );
}

export function RecheckButton() {
  const t = useT();
  return (
    <button type="button" onClick={() => window.location.reload()} className="h-11 rounded-full bg-accent px-6 font-medium text-on-accent hover:bg-accent-hover">
      {t("Check again")}
    </button>
  );
}
