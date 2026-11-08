import { v4, v5 } from "uuid";

/** Fixed namespace for deterministic child ids (UUIDv5), spec 4.4. */
export const VALEMONT_NS = "6f1c1d9e-3b7a-5d2e-9a64-2c8f0b7e4a11";

export const newId = () => v4();
export const childId = (...parts: string[]) => v5(parts.join(":"), VALEMONT_NS);

/**
 * Google Calendar event id derived from a record UUID (spec 4.13): UUIDv5 bytes in base32hex
 * (lowercase 0-9 a-v), so a retried insert reuses the same id and cannot create a duplicate.
 */
export function calendarEventId(...parts: string[]): string {
  const hex = childId("calendar-event", ...parts).replace(/-/g, "");
  const alphabet = "0123456789abcdefghijklmnopqrstuv";
  let bits = "";
  for (const h of hex) bits += parseInt(h, 16).toString(2).padStart(4, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}
