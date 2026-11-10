import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

// Public pages only. New routes join this list as the redesign lands them.
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/app", "/record", "/simulation"].map((p) => ({ url: `${SITE}${p}`, changeFrequency: p === "/simulation" ? "monthly" : "hourly" }));
}
