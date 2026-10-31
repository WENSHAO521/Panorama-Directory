# Panorama Directory

Editorial directory for Panorama Scholarly Group, served at
<https://profiles.panorama-sg.com>. Built with [Astro](https://astro.build) and
Tailwind CSS v4, deployed as static assets on Cloudflare Workers (a small Worker
only handles sign-in for the `/admin` editor and the scholar self-service
editor at `/edit`).

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

### Editing in the browser (`/admin`)

Non-technical editors can use the form-based editor at
<https://profiles.panorama-sg.com/admin/> ([Decap CMS](https://decapcms.org)).
They sign in with a GitHub account that is both listed in
`ALLOWED_GITHUB_USERS` (`wrangler.jsonc`) and has write access to this
repository. Saves are drafts: each one becomes a branch and pull request, shown
on the editor's “工作流” board, and only goes live when someone with merge
rights presses Publish, which merges it into `main` and triggers the normal
rebuild and redeploy (about a minute or two). If a change ever breaks
validation, the build fails and the previous version of the site stays live.

To add an editor: invite their GitHub account as a collaborator (Settings →
Collaborators) and add their login to `ALLOWED_GITHUB_USERS`. To remove one,
do both in reverse.

- Editor look: `public/admin/admin.css` restyles Decap as a quiet,
  document-style workspace (Geist, self-hosted in `public/admin/fonts/`). It
  targets Decap's component names in its class names, so check `/admin` after
  upgrading Decap.
- Editor config: `public/admin/config.yml`. Its fields mirror the schema in
  `src/content.config.ts`; when you add a field to one, add it to the other.
- GitHub sign-in runs on the site itself: `worker/oauth.ts`, wired up by
  `worker/index.ts` (Workers) and `functions/oauth/[[path]].ts` (Pages). It
  needs a GitHub OAuth App with callback URL
  `https://profiles.panorama-sg.com/oauth/callback`, and two secrets on the
  Cloudflare project: `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Accounts
  not in `ALLOWED_GITHUB_USERS` are refused there and their token is revoked
  (on Pages, set that variable in the dashboard instead; if it is missing,
  only the repository owner can sign in).
- `public/_headers` stops other sites framing `/admin` and keeps it out of
  search engines; `public/admin/index.html` pins the Decap script by hash.
- To try the editor locally without signing in, run `npx decap-server` next to
  `npm run dev` and open <http://localhost:4321/admin/index.html>; saves go to
  your local files.

### Scholars editing their own page (`/edit`)

Scholars sign in at <https://profiles.panorama-sg.com/edit> with a one-time
link mailed to them (Alibaba Cloud DirectMail). If an entry lists that address,
in its `email` or under `loginEmails` (“自助编辑登录邮箱” in `/admin`), they
can edit that entry only. Otherwise they get a blank form and can submit a
new entry, which records the address in `loginEmails`. Each submission is
committed by a GitHub App to the same branch and pull request Decap uses for
that entry (`cms/scholars/<slug>`, labelled pending review), so it shows up in
the `/admin` Workflow tab and goes live only when you publish it. Scholars
cannot change `order`, `role`, `email` or `loginEmails` on an existing entry,
and can write only their own entry and a new photo for it; the Worker
enforces this. A new entry's position is the applicant's own wording, so
check it (and the person) before publishing.

- Code: `worker/selfservice.ts` (routes, sessions), `worker/entry.ts`
  (frontmatter and what a scholar may change; keep in sync with
  `src/content.config.ts`), `worker/github.ts` (GitHub App),
  `worker/mail.ts` (Alibaba Cloud DirectMail), `src/pages/edit.astro` +
  `src/scripts/edit.ts` (the form).
- Secrets on the Cloudflare project: `SESSION_SECRET` (any long random
  string), `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (the downloaded .pem as
  is), `ALIYUN_ACCESS_KEY_ID`, `ALIYUN_ACCESS_KEY_SECRET`. Vars in
  `wrangler.jsonc` (on Pages, set them in the dashboard): `ALIYUN_DM_ACCOUNT`
  (the DirectMail sender address) and `ALIYUN_DM_REGION`. Until all are set,
  `/edit` says sign-in is not available.
- GitHub App: repository permissions Contents and Pull requests (read and
  write), installed on this repository only.

## Design

Publisher editorial-board style (in the manner of Springer Nature or De Gruyter
board pages), defined in `src/styles/global.css`: Inter, navy brand colour
(`--color-brand`) on white and light grey surfaces, small radii, and thin rules.
The board is grouped by role tier (`TIERS` in `src/lib/scholars.ts`: a member's
`role` text decides the tier). Identifiers render as badges (`IdBadges`: green
ORCID iD, letter badges for others) and publications as citations
(`ProfileSection`).

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
public/admin/         the /admin editor (Decap CMS) and its config
worker/               Worker entry, GitHub sign-in for /admin, /edit back end
functions/            the same routes as Pages Functions
```
