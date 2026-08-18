import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "pos_token";

function decodeJwt(token: string): { role?: string; exp?: number } | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Route publik
const PUBLIC_PATHS = ["/login"];

// Guard per prefix route (di luar kasir sudah dibatasi server; ini untuk UX)
const ROLE_ROUTES: { prefix: string; roles: string[] }[] = [
  { prefix: "/users", roles: ["admin"] },
  { prefix: "/settings", roles: ["admin"] },
  { prefix: "/dashboard", roles: ["admin", "manager"] },
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // File statis & asset selalu lolos
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api/") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.includes(pathname)) {
    // Sudah login → jangan tampilkan halaman login
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (token && decodeJwt(token)) {
      const payload = decodeJwt(token);
      const home = payload?.role === "kasir" ? "/pos" : "/dashboard";
      return NextResponse.redirect(new URL(home, request.url));
    }
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token || !decodeJwt(token)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const payload = decodeJwt(token)!;

  // Root → arahkan sesuai role
  if (pathname === "/") {
    const home = payload.role === "kasir" ? "/pos" : "/dashboard";
    return NextResponse.redirect(new URL(home, request.url));
  }

  // Role guard per prefix
  for (const rule of ROLE_ROUTES) {
    if (pathname === rule.prefix || pathname.startsWith(rule.prefix + "/")) {
      if (!payload.role || !rule.roles.includes(payload.role)) {
        const fallback = payload.role === "kasir" ? "/pos" : "/dashboard";
        return NextResponse.redirect(new URL(fallback, request.url));
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
