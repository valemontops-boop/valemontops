import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { FOUNDERS, type FounderKey } from "@/domain/constants";
import { getConfig } from "@/server/config";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/server/session";

/** DEMO sign-in only (D010). Refused in LIVE mode. */
export async function POST(req: NextRequest) {
  const cfg = getConfig();
  const back = (q: string) => NextResponse.redirect(new URL(`/login?${q}`, req.url), 303);
  if (!cfg.ok) return NextResponse.redirect(new URL("/setup", req.url), 303);
  if (cfg.mode !== "demo") return back("error=demo_disabled");
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return back("error=bad_origin");
  const form = await req.formData();
  const founder = String(form.get("founder") ?? "") as FounderKey;
  if (!FOUNDERS.includes(founder)) return back("error=unknown_founder");
  if (cfg.demo.accessCode) {
    const given = Buffer.from(String(form.get("code") ?? ""));
    const want = Buffer.from(cfg.demo.accessCode);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return back("error=bad_code");
  }
  const res = NextResponse.redirect(new URL("/my-day", req.url), 303);
  res.cookies.set(SESSION_COOKIE, await createSessionToken({ founder, role: "founder", mode: "demo" }, cfg.sessionSecret), sessionCookieOptions(cfg.production));
  return res;
}
