import { NextResponse, type NextRequest } from "next/server";

// Leichte Zugriffskontrolle am Rand: ohne Session-Cookie → /login.
// Die eigentliche Session-Validierung (DB) passiert serverseitig in
// requireUser()/requireRole() – hier nur schneller Redirect.
export function middleware(request: NextRequest) {
  const isLoggedIn = request.cookies.has("erp_session");
  const { pathname } = request.nextUrl;

  if (!isLoggedIn && pathname !== "/login" && !pathname.startsWith("/api")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
