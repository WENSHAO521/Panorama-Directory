export async function onRequestGet() {
  return new Response(
`User-agent: *
Allow: /

Sitemap: https://profiles.panorama-sg.com/sitemap.xml
`,
    {
      headers: {
        "Content-Type": "text/plain",
      },
    }
  );
}
