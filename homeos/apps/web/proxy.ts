import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseConfig, localModeAllowed, SESSION_COOKIE_OPTIONS } from "@/lib/supabase/config";
import { ACCESS_COOKIE, accessCode, isLoopbackRequest, validAccessCookie } from "@/lib/server/local-access";

const PUBLIC_PATHS = ["/login", "/registreren", "/wachtwoord-vergeten", "/auth/", "/setup"];

/**
 * Draait vóór iedere pagina en API-route:
 * - ververst de Supabase-sessie (httpOnly-cookies)
 * - stuurt niet-ingelogde bezoekers naar /login (API: 401)
 * - weigert in productie de accountloze lokale modus, tenzij expliciet toegestaan
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
  const isApi = pathname.startsWith("/api/");
  const config = getSupabaseConfig();

  if (!config) {
    if (localModeAllowed()) {
      // Lokale modus zonder accounts: op de laptop zelf vrij; van buiten (telefoon via Tailscale) alleen met toegangscode.
      if (isLoopbackRequest(request.headers) || pathname === "/toegang" || pathname === "/api/access") return NextResponse.next();
      if (accessCode() && validAccessCookie(request.cookies.get(ACCESS_COOKIE)?.value)) return NextResponse.next();
      if (isApi) return NextResponse.json({ error: { code: "ACCESS_CODE_REQUIRED", message: "Toegangscode vereist" } }, { status: 401 });
      const url = new URL("/toegang", request.url);
      if (pathname !== "/") url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    if (pathname === "/setup") return NextResponse.next();
    if (isApi) return NextResponse.json({ error: { code: "AUTH_NOT_CONFIGURED", message: "Supabase is niet geconfigureerd" } }, { status: 503 });
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.key, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS });
      },
    },
  });

  // getUser() valideert het token bij Supabase Auth (niet alleen de cookie lezen).
  const { data } = await supabase.auth.getUser();
  const loggedIn = !!data.user;

  if (!loggedIn && !isPublic) {
    if (isApi) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Log opnieuw in" } }, { status: 401 });
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (loggedIn && (pathname === "/login" || pathname === "/registreren")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|manifest.webmanifest|favicon.ico|sw.js|offline.html|apple-touch-icon.png|icon-192.png|icon-512.png|icon-maskable-512.png|badge-96.png).*)"],
};
