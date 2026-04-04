import scholars from "../data/scholars.json";

export async function onRequestGet() {
  const baseUrl = "https://profiles.panorama-sg.com";
  const now = new Date().toISOString();

  // 1️⃣ 静态页面
  const staticPages = [
    "/",
    "/about.html",
    "/contact.html",
    "/directory.html",
  ];

  const staticUrls = staticPages.map((path) => ({
    loc: `${baseUrl}${path}`,
    lastmod: now,
    changefreq: "weekly",
    priority: path === "/" ? "1.0" : "0.8",
  }));

  // 2️⃣ 学者页面（自动）
  const scholarUrls = scholars.map((item) => {
    // ⚠️ 这里要看你真实路径
    // 如果是 /board/xxx.html
    const path = `/board/${item.slug}.html`;

    return {
      loc: `${baseUrl}${path}`,
      lastmod: item.updatedAt
        ? new Date(item.updatedAt).toISOString()
        : now,
      changefreq: "monthly",
      priority: "0.8",
    };
  });

  const allUrls = [...staticUrls, ...scholarUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
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
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
