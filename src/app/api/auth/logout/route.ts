import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/session";
import { isCrossOrigin } from "@/server/guard";

export async function POST(req: NextRequest) {
  // Same-origin only: a cross-site page cannot sign a founder out (D084).
  if (isCrossOrigin(req)) return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
