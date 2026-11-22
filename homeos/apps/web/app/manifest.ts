import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "HomeOS",
    short_name: "HomeOS",
    description: "Your home. One intelligent system.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#04060c",
    theme_color: "#04060c",
    lang: "nl",
    categories: ["utilities", "lifestyle"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Jarvis", url: "/jarvis" },
      { name: "Energie", url: "/energie" },
      { name: "Beveiliging", url: "/beveiliging" },
    ],
  };
}
