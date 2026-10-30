import type { APIRoute } from "astro";
import { getScholars, profileUrl } from "../lib/scholars";

export const GET: APIRoute = async ({ site }) => {
  const scholars = await getScholars();
  const pages = [
    { path: "/", priority: "1.0" },
    { path: "/directory", priority: "0.9" },
    { path: "/about", priority: "0.8" },
    { path: "/contact", priority: "0.7" },
    ...scholars.map((s) => ({ path: profileUrl(s), priority: "0.8" })),
  ];
  const lastmod = new Date().toISOString();
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${new URL(p.path, site)}</loc><lastmod>${lastmod}</lastmod><priority>${p.priority}</priority></url>`).join("\n")}
</urlset>
`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
