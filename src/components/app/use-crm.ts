"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { crmSnapshot } from "@/server/services/crm";
import type { getMyDay } from "@/server/services/myday";

export type Crm = Awaited<ReturnType<typeof crmSnapshot>>;
export type CrmAccount = Crm["accounts"][number];
export type CrmContact = Crm["contacts"][number];
export type CrmOpp = Crm["opportunities"][number];
export type MyDayData = Awaited<ReturnType<typeof getMyDay>>;

export function useCrm() {
  return useQuery({ queryKey: ["crm"], queryFn: () => api<Crm>("/api/crm") });
}
export function useMyDay() {
  return useQuery({ queryKey: ["my-day"], queryFn: () => api<MyDayData>("/api/my-day") });
}
