export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    const now = new Date().toISOString();

    // =========================
    // 1. 动态生成 sitemap.xml
    // =========================
    if (url.pathname === "/sitemap.xml") {
      let rawData = null;
      let scholars = [];

      try {
        const scholarsReq = new Request(`${baseUrl}/data/scholars.json`);
        const scholarsRes = await env.ASSETS.fetch(scholarsReq);

        if (scholarsRes.ok) {
          rawData = await scholarsRes.json();
        }
      } catch (error) {
        rawData = null;
      }

      // 兼容多种 JSON 结构
      if (Array.isArray(rawData)) {
        scholars = rawData;
      } else if (rawData && Array.isArray(rawData.scholars)) {
        scholars = rawData.scholars;
      } else if (rawData && Array.isArray(rawData.data)) {
        scholars = rawData.data;
      } else {
        scholars = [];
      }

      // 静态页面
      const staticPages = [
        {
          loc: `${baseUrl}/`,
          lastmod: now,
          changefreq: "weekly",
          priority: "1.0"
        },
        {
          loc: `${baseUrl}/about.html`,
          lastmod: now,
          changefreq: "monthly",
          priority: "0.8"
        },
        {
          loc: `${baseUrl}/contact.html`,
          lastmod: now,
          changefreq: "monthly",
          priority: "0.7"
        },
        {
          loc: `${baseUrl}/directory.html`,
          lastmod: now,
          changefreq: "weekly",
          priority: "0.9"
        }
      ];

      // 学者页面：优先读取 profileLink
      const scholarPages = scholars
        .map((item) => {
          if (!item || typeof item !== "object") return null;

          let pagePath = null;

          // 1) 你的当前数据格式：profileLink
          if (typeof item.profileLink === "string" && item.profileLink.trim()) {
            pagePath = item.profileLink.trim();
          }
          // 2) 兼容 file
          else if (typeof item.file === "string" && item.file.trim()) {
            pagePath = item.file.trim().startsWith("board/")
              ? item.file.trim()
              : `board/${item.file.trim()}`;
          }
          // 3) 兼容 filename
          else if (typeof item.filename === "string" && item.filename.trim()) {
            pagePath = item.filename.trim().startsWith("board/")
              ? item.filename.trim()
              : `board/${item.filename.trim()}`;
          }
          // 4) 兼容 slug
          else if (typeof item.slug === "string" && item.slug.trim()) {
            pagePath = `board/${item.slug.trim()}.html`;
          }

          if (!pagePath) return null;

          // 去掉开头多余的 /
          pagePath = pagePath.replace(/^\/+/, "");

          // 如果没有 .html，补上
          if (!pagePath.endsWith(".html")) {
            pagePath = `${pagePath}.html`;
          }

          let lastmod = now;
          if (item.updatedAt) {
            const parsed = new Date(item.updatedAt);
            if (!isNaN(parsed.getTime())) {
              lastmod = parsed.toISOString();
            }
          }

          return {
            loc: `${baseUrl}/${pagePath}`,
            lastmod,
            changefreq: "monthly",
            priority: "0.8"
          };
        })
        .filter(Boolean);

      // 去重
      const uniqueMap = new Map();
      [...staticPages, ...scholarPages].forEach((page) => {
        uniqueMap.set(page.loc, page);
      });
      const allPages = Array.from(uniqueMap.values());

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages
  .map(
    (page) => `  <url>
    <loc>${escapeXml(page.loc)}</loc>
    <lastmod>${escapeXml(page.lastmod)}</lastmod>
    <changefreq>${escapeXml(page.changefreq)}</changefreq>
    <priority>${escapeXml(page.priority)}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

      return new Response(xml, {
        headers: {
          "Content-Type": "application/xml; charset=UTF-8",
          "Cache-Control": "public, max-age=3600"
        }
      });
    }

    // =========================
    // 2. 动态生成 robots.txt
    // =========================
    if (url.pathname === "/robots.txt") {
      const txt = `User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml
`;

      return new Response(txt, {
        headers: {
          "Content-Type": "text/plain; charset=UTF-8",
          "Cache-Control": "public, max-age=3600"
        }
      });
    }

    // =========================
    // 3. 其他请求走静态资源
    // =========================
    return env.ASSETS.fetch(request);
  }
};

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
