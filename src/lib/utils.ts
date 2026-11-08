import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatEur(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "—";
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function timeOfDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}
