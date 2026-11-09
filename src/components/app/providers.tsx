"use client";
import { MutationCache, QueryClient, QueryClientProvider, useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { Toaster } from "sonner";
import { api } from "@/lib/api";
import type { PublicConfig } from "@/server/config";
import type { FounderKey } from "@/domain/constants";
import { LOCALE_OF } from "@/i18n";
import { I18nProvider } from "@/i18n/react";

/* ---------- save-state store (server-confirmed only) ---------- */
type SaveState = { lastSavedAt: string | null; lastError: string | null };
let saveState: SaveState = { lastSavedAt: null, lastError: null };
const listeners = new Set<() => void>();
function setSave(p: Partial<SaveState>) {
  saveState = { ...saveState, ...p };
  listeners.forEach((l) => l());
}
export function useSaveState() {
  return React.useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => saveState,
    () => saveState,
  );
}

export interface Me {
  founder: FounderKey;
  name: string;
  config: PublicConfig;
}
const MeCtx = React.createContext<Me | null>(null);
export function useMe(): Me {
  const v = React.useContext(MeCtx);
  if (!v) throw new Error("useMe outside provider");
  return v;
}

export function Providers({ me, children }: { me: Me; children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 } },
        mutationCache: new MutationCache({
          onSuccess: () => setSave({ lastSavedAt: new Date().toISOString(), lastError: null }),
          onError: (e) => setSave({ lastError: (e as Error).message }),
        }),
      }),
  );
  React.useEffect(() => {
    // The static preview grants Google access without a page load; it asks for a refetch this way.
    const onRefetch = () => void client.invalidateQueries();
    window.addEventListener("vos-refetch", onRefetch);
    return () => window.removeEventListener("vos-refetch", onRefetch);
  }, [client]);
  return (
    <MeCtx.Provider value={me}>
      <I18nProvider locale={LOCALE_OF[me.founder]}>
      <QueryClientProvider client={client}>
        <SyncPoller pollSeconds={me.config.pollSeconds} />
        {children}
        <Toaster position="bottom-center" toastOptions={{ style: { borderRadius: 999, background: "#17161A", color: "#FBFAF7", border: "none" } }} />
      </QueryClientProvider>
      </I18nProvider>
    </MeCtx.Provider>
  );
}

/** Polls the revision tokens; when any domain changed, refetches data (spec 3.7, 4.1). */
const syncQuery = (pollSeconds: number) => ({
  queryKey: ["sync"],
  queryFn: () => api<{ revisions: Record<string, string>; at: string }>("/api/sync"),
  refetchInterval: pollSeconds * 1000,
  refetchOnWindowFocus: true,
  retry: 0,
});

function SyncPoller({ pollSeconds }: { pollSeconds: number }) {
  const qc = useQueryClient();
  const prev = React.useRef<string | null>(null);
  const q = useQuery(syncQuery(pollSeconds));
  React.useEffect(() => {
    if (!q.data) return;
    const sig = JSON.stringify(q.data.revisions);
    if (prev.current && prev.current !== sig) qc.invalidateQueries({ predicate: (x) => x.queryKey[0] !== "sync" });
    prev.current = sig;
  }, [q.data, qc]);
  return null;
}

export function useSyncStatus() {
  const mutating = useIsMutating();
  const s = useSaveState();
  const qc = useQueryClient();
  const me = useMe();
  const syncQ = useQuery(syncQuery(me.config.pollSeconds));
  const sync = { dataUpdatedAt: syncQ.dataUpdatedAt, status: syncQ.status, error: syncQ.error };
  const status: "syncing" | "error" | "saved" = mutating > 0 ? "syncing" : s.lastError || sync?.status === "error" ? "error" : "saved";
  return {
    status,
    lastSyncAt: sync?.dataUpdatedAt ? new Date(sync.dataUpdatedAt).toISOString() : null,
    error: s.lastError ?? (sync?.error ? (sync.error as Error).message : null),
    refresh: () => {
      setSave({ lastError: null });
      return qc.invalidateQueries();
    },
  };
}
