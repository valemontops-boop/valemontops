import { NextResponse, type NextRequest } from "next/server";

/** Cheap presence check only; real verification happens server-side on every page and API route. */
export function proxy(req: NextRequest) {
  if (!req.cookies.get("vos_session")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/my-day/:path*", "/crm/:path*", "/settings/:path*", "/command-center/:path*", "/marketing/:path*", "/tasks/:path*", "/agenda/:path*", "/ideas/:path*", "/files/:path*", "/reports/:path*", "/call/:path*", "/money/:path*", "/clients/:path*"],
};
