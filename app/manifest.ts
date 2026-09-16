import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "Прокачка", short_name: "Прокачка",
    description: "Задания, команда и твой рост",
    lang: "ru", start_url: "/", scope: "/", display: "standalone",
    background_color: "#101d35", theme_color: "#101d35",
    icons: [
      { src: "/brand-icon-small", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand-icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand-icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
