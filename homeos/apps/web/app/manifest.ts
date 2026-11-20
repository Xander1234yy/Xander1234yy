import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HomeOS",
    short_name: "HomeOS",
    description: "Your home. One intelligent system.",
    start_url: "/",
    display: "standalone",
    background_color: "#04060c",
    theme_color: "#04060c",
    lang: "nl",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
