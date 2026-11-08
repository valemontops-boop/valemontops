import { hhmm, localDate, localMinutes, weekday } from "./time";

export interface Interval { start: Date; end: Date }
export interface FounderAvailability { tz: string; workdays: number[]; availStart: string; availEnd: string }

/**
 * Three slots free for both founders inside each one's declared availability (spec 5.12).
 * Pure: busy intervals come from the calendars' free/busy, already merged.
 */
export function findMutualSlots(opts: { busy: Interval[]; founders: FounderAvailability[]; from: Date; days: number; durationMin: number; stepMin?: number; count?: number }): Interval[] {
  const step = (opts.stepMin ?? 30) * 60_000;
  const dur = opts.durationMin * 60_000;
  const out: Interval[] = [];
  let t = Math.ceil(opts.from.getTime() / step) * step;
  const end = opts.from.getTime() + opts.days * 86_400_000;
  const okFor = (f: FounderAvailability, s: Date, e: Date) => {
    const a = hhmm(f.availStart);
    const b = hhmm(f.availEnd);
    if (a === null || b === null) return false;
    const sd = localDate(s, f.tz);
    const ed = localDate(new Date(e.getTime() - 1), f.tz);
    if (sd !== ed || !f.workdays.includes(weekday(sd))) return false;
    const sm = localMinutes(s, f.tz);
    const em = sm + (e.getTime() - s.getTime()) / 60_000;
    return sm >= a && em <= b;
  };
  for (; t + dur <= end && out.length < (opts.count ?? 3); t += step) {
    const s = new Date(t);
    const e = new Date(t + dur);
    if (!opts.founders.every((f) => okFor(f, s, e))) continue;
    if (opts.busy.some((b) => b.start < e && b.end > s)) continue;
    out.push({ start: s, end: e });
  }
  return out;
}
