import scholars from "../data/scholars.json";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    const now = new Date().toISOString();

    if (url.pathname === "/sitemap.xml") {
      const staticPages = [
        {
          loc: `${baseUrl}/`,
          lastmod: now,
          changefreq: "weekly",
          priority: "1.0",
        },
        {
          loc: `${baseUrl}/about.html`,
          lastmod: now,
          changefreq: "monthly",
          priority: "0.8",
        },
        {
          loc: `${baseUrl}/contact.html`,
          lastmod: now,
          changefreq: "monthly",
          priority: "0.7",
        },
        {
          loc: `${baseUrl}/directory.html`,
          lastmod: now,
          changefreq: "weekly",
          priority: "0.9",
        },
      ];

      const scholarPages = (scholars || [])
        .filter((item) => item.slug)
        .map((item) => ({
          loc: `${baseUrl}/board/${item.slug}.html`,
          lastmod: item.updatedAt
            ? new Date(item.updatedAt).toISOString()
            : now,
          changefreq: "monthly",
          priority: "0.8",
        }));

      const allPages = [...staticPages, ...scholarPages];

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages
  .map(
    (page) => `  <url>
    <loc>${page.loc}</loc>
    <lastmod>${page.lastmod}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

      return new Response(xml, {
        headers: {
          "Content-Type": "application/xml; charset=UTF-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    if (url.pathname === "/robots.txt") {
      const txt = `User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml
`;
      return new Response(txt, {
        headers: {
          "Content-Type": "text/plain; charset=UTF-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
