import { NextResponse, type NextRequest } from "next/server";

const PAGES = ["/install", "/my-day", "/crm", "/settings", "/command-center", "/marketing", "/tasks", "/agenda", "/ideas", "/files", "/reports", "/call", "/money", "/clients"];

/**
 * 1. Correlation id (D084): every page and API request carries `x-request-id` (the caller's when it is a safe token,
 *    else a new UUID), forwarded to the route handler and echoed on the response, so one id ties the browser, the
 *    structured logs and the audit row together.
 * 2. Cheap presence check on app pages only; real verification happens server-side on every page and API route.
 */
export function proxy(req: NextRequest) {
  const given = req.headers.get("x-request-id") ?? "";
  const id = /^[A-Za-z0-9._:-]{8,128}$/.test(given) ? given : crypto.randomUUID();
  const path = req.nextUrl.pathname;
  if (PAGES.some((p) => path === p || path.startsWith(`${p}/`)) && !req.cookies.get("vos_session")) {
    const r = NextResponse.redirect(new URL("/login", req.url));
    r.headers.set("x-request-id", id);
    return r;
  }
  const headers = new Headers(req.headers);
  headers.set("x-request-id", id);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", id);
  return res;
}

export const config = {
  matcher: [
    "/api/:path*", "/install",
    "/my-day/:path*", "/crm/:path*", "/settings/:path*", "/command-center/:path*", "/marketing/:path*", "/tasks/:path*",
    "/agenda/:path*", "/ideas/:path*", "/files/:path*", "/reports/:path*", "/call/:path*", "/money/:path*", "/clients/:path*",
  ],
};
