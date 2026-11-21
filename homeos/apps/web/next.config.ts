import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
];

/**
 * Fase 8: CSP als extra verdediging tegen ingespoten scripts. Alles van de eigen origin; Next.js gebruikt inline
 * scripts voor hydratie (daarom 'unsafe-inline' voor scripts, zonder externe bronnen). In ontwikkeling ook eval/ws voor
 * hot reload. Geen form-action: OAuth-koppelingen (Daikin, Hue, Google) verwijzen door naar de inlogpagina van de dienst.
 */
function contentSecurityPolicy(): string {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Extra hostnamen (bijv. een Tailscale-adres) als die proxy niet de eigen host doorgeeft. Komma-gescheiden.
const allowedOrigins = (process.env.HOMEOS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  ...(allowedOrigins.length ? { experimental: { serverActions: { allowedOrigins } } } : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@homeos/shared", "@homeos/ui", "@homeos/automation", "@homeos/jarvis", "@homeos/integrations", "@homeos/connector"],
  serverExternalPackages: ["ws", "web-push", "postgres", "@matter/main", "@matter/nodejs", "@project-chip/matter.js"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
