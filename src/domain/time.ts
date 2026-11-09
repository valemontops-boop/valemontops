/** Time-zone helpers using Intl only (no I/O). Dates are local `YYYY-MM-DD` strings. */

const dateFmt = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = dateFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    dateFmt.set(tz, f);
  }
  return f;
}

function parts(instant: Date, tz: string) {
  const p = Object.fromEntries(fmt(tz).formatToParts(instant).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localDate(instant: Date | string, tz: string): string {
  const { y, m, d } = parts(typeof instant === "string" ? new Date(instant) : instant, tz);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday of the ISO week containing `date`. */
export function startOfWeek(date: string): string {
  const wd = weekday(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

function offsetMs(instant: Date, tz: string): number {
  const p = parts(instant, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** UTC instant of local midnight at the start of `date` in `tz`. */
export function startOfLocalDay(date: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

/** The local cutoff of a day is the next local midnight (spec 5.4). */
export function cutoffOf(date: string, tz: string): Date {
  return startOfLocalDay(addDays(date, 1), tz);
}

/** Logged after the local cutoff of the day the activity occurred on. */
export function isLateLogged(occurredAt: string, loggedAt: string, tz: string): boolean {
  return new Date(loggedAt).getTime() >= cutoffOf(localDate(occurredAt, tz), tz).getTime();
}

/** Minutes since local midnight of an instant in `tz`. */
export function localMinutes(instant: Date, tz: string): number {
  const { h, mi } = parts(instant, tz);
  return h * 60 + mi;
}

/** "HH:MM" -> minutes; invalid -> null. */
export function hhmm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]) * 60 + Number(m[2]);
  return n >= 0 && n <= 24 * 60 ? n : null;
}
