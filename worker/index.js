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
      // 1) [ {...}, {...} ]
      // 2) { scholars: [ {...}, {...} ] }
      // 3) { data: [ {...}, {...} ] }
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

      // 学者页面
      const scholarPages = scholars
        .map((item) => {
          if (!item || typeof item !== "object") return null;

          // 优先级：
          // 1. file / filename 直接当文件名用
          // 2. slug + ".html"
          let fileName = null;

          if (typeof item.file === "string" && item.file.trim()) {
            fileName = item.file.trim();
          } else if (typeof item.filename === "string" && item.filename.trim()) {
            fileName = item.filename.trim();
          } else if (typeof item.slug === "string" && item.slug.trim()) {
            fileName = `${item.slug.trim()}.html`;
          }

          if (!fileName) return null;

          // 防止重复写 .html.html
          if (!fileName.endsWith(".html")) {
            fileName = `${fileName}.html`;
          }

          let lastmod = now;
          if (item.updatedAt) {
            const parsed = new Date(item.updatedAt);
            if (!isNaN(parsed.getTime())) {
              lastmod = parsed.toISOString();
            }
          }

          return {
            loc: `${baseUrl}/board/${fileName}`,
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
    // 3. 其余请求走静态资源
    // =========================
    return env.ASSETS.fetch(request);
  }
};

// XML 转义，避免特殊字符导致 XML 结构异常
function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
