# Panorama Directory

Editorial directory for Panorama Scholarly Group, served at
<https://profiles.panorama-sg.com>. Built with [Astro](https://astro.build) and
Tailwind CSS v4, deployed as static assets on Cloudflare Workers.

## Working on the site

```sh
npm install
npm run dev       # local dev server at http://localhost:4321
npm run build     # static build into dist/
npm run preview   # serve dist/ through wrangler, like production
npm run check     # type-check .astro files and content
npm run deploy    # build + wrangler deploy
```

Requires Node 22.22 or newer (see `.node-version`).

## Adding or editing a scholar

Each scholar is one Markdown file in `src/content/scholars/<slug>.md`; the
profile is published at `/board/<slug>`.

- The frontmatter holds structured data (name, role, affiliation, photo,
  identifiers, keywords, and the publication/appointment `sections`). The
  schema in `src/content.config.ts` validates it at build time, so a typo or a
  missing field fails the build instead of shipping a broken page.
- The Markdown body is the biography. Use `*text*` for italics (journal names).
- Photos go in `src/assets/scholars/` and are referenced as
  `photo: ../../assets/scholars/<file>`. They are resized and converted to WebP
  automatically. Unreferenced photos there are kept for upcoming members and
  are not published.
- `order` controls the position on the home page (the three lowest are
  featured); the directory itself is alphabetical.

Section `layout: list` renders `type: publication` rows; `layout: grid`
renders `type: card` items (appointments, honours, expertise). A card's
`icon` field is kept in the data but not drawn by the current design.

## Design

Functional German/Swiss typographic style, defined in `src/styles/global.css`:
one grotesk typeface (Inter), a 12-column grid (`wrap` + `grid-12`), black on
white with hairline rules, and signal red (`--color-signal`) only for
emphasis and state. Section headers are numbered (`SectionHeading`).

## Icons

Icons use a self-hosted subset of Material Symbols. After using a new icon
name in `<Icon name="...">`, regenerate the subset:

```sh
pip install fonttools brotli
npm run build:icons
```

## Project layout

```
src/
  content/scholars/   scholar profiles (Markdown + frontmatter)
  assets/             photos and logos (optimised at build time)
  components/         Nav, Footer, ScholarCard, ProfileSection, ...
  layouts/            BaseLayout (head, SEO tags, nav, footer)
  pages/              routes; board/[slug].astro renders every profile
  styles/global.css   design tokens, fonts, shared utilities
public/               files served as-is (fonts, favicon, verification file)
```
