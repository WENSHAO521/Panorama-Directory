// Self-service editing for scholars at /edit.
//
// A scholar proves they own an email address by clicking a one-time link
// mailed to it. If an entry lists that address (`email` or `loginEmails`,
// set by the admin) they can edit that entry only; otherwise they can submit
// a new entry, which records the address in `loginEmails` so they can keep
// editing it. Each save is committed by the GitHub App to the Decap branch for that entry (cms/scholars/<slug>) and labelled "pending review",
// so it shows up in the /admin editorial workflow and goes live only when
// the admin publishes it. Admin-only fields (see ADMIN_ONLY) are never taken
// from the scholar.
//
// No database: sessions and login links are HMAC-signed with SESSION_SECRET.
//
// Secrets: SESSION_SECRET, the Alibaba Cloud DirectMail ones in mail.ts and
// the GitHub App ones in github.ts. Until all are set, /edit says sign-in is
// not available.
import { ADMIN_ONLY, InvalidEntry, loginEmails, mergeSubmission, parseEntry, PHOTO_PREFIX, PHOTOS_DIR, SCHOLARS_DIR, serializeEntry, type Data } from "./entry";
import { b64url, githubConfigured, GitHubError, Repo, type GitHubEnv } from "./github";
import { mailConfigured, sendMail, type MailEnv } from "./mail";

export interface SelfServiceEnv extends GitHubEnv, MailEnv {
  SESSION_SECRET?: string;
}

const SESSION_COOKIE = "__Host-pd_session";
const SESSION_HOURS = 8;
const LINK_MINUTES = 20;
const BASE_BRANCH = "main";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

export function isSelfServicePath(pathname: string): boolean {
  return pathname.startsWith("/auth/") || pathname === "/api/me";
}

export async function handleSelfService(request: Request, env: SelfServiceEnv): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  try {
    // Names only (never values), so the admin can see what is left to set.
    const missing = (["SESSION_SECRET", "GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "ALIYUN_DM_ACCOUNT", "ALIYUN_SMTP_PASSWORD"] as const).filter(
      (name) => !env[name],
    );
    if (missing.length || !githubConfigured(env) || !mailConfigured(env)) {
      return request.method === "GET" && url.pathname.startsWith("/auth/")
        ? redirect("/edit?error=not_configured")
        : json({ error: "not_configured", missing }, 503);
    }
    switch (route) {
      case "POST /auth/email":
        return await emailStart(request, url, env);
      case "GET /auth/email/verify":
        return await emailFinish(url, env);
      case "POST /auth/logout":
        return redirect("/edit", clearCookie(SESSION_COOKIE));
      case "GET /api/me":
        return await loadEntry(request, env);
      case "POST /api/me":
        return await saveEntry(request, url, env);
    }
    return new Response("Not found", { status: 404 });
  } catch (e) {
    if (e instanceof InvalidEntry) return json({ error: "invalid", message: e.message }, 400);
    console.error(e);
    // GitHub's own error text (status, endpoint, its message) holds no
    // secrets and says which setting is wrong, so pass it on.
    return json(
      { error: "server", message: e instanceof GitHubError ? `GitHub request failed: ${e.message.slice(0, 300)}` : "Unexpected error" },
      500,
    );
  }
}

// ---- One-time login link by email ----------------------------------------

async function emailStart(request: Request, url: URL, env: SelfServiceEnv): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);
  const { email } = (await request.json().catch(() => ({}))) as { email?: unknown };
  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
    return json({ error: "invalid", message: "Please enter a valid email address." }, 400);
  }
  const address = email.trim().toLowerCase();

  // Anyone may sign in (someone not yet listed can submit a new entry), so
  // every valid address gets a link: at most one a minute per address and
  // one every 20 seconds per visitor, so the form can't be used to spam.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if ((await firstSendIn(`ip/${ip}`, 20)) && (await firstSendIn(`to/${address}`, 60))) {
    const token = await sign({ p: "link", e: address, x: Date.now() + LINK_MINUTES * 60_000 }, env.SESSION_SECRET!);
    const link = `${url.origin}/auth/email/verify?t=${encodeURIComponent(token)}`;
    await sendLoginEmail(env, address, link);
  }
  return json({ ok: true });
}

async function emailFinish(url: URL, env: SelfServiceEnv): Promise<Response> {
  const claims = await verify(url.searchParams.get("t") ?? "", env.SESSION_SECRET!);
  if (!claims || claims.p !== "link" || typeof claims.e !== "string") return redirect("/edit?error=link_expired");
  return signIn(claims.e, env);
}

async function sendLoginEmail(env: SelfServiceEnv, to: string, link: string): Promise<void> {
  const text = [
    "Use the link below to sign in and update or create your profile on the Panorama Scholarly Group Editorial Directory.",
    "请点击下面的链接登录，编辑或新建您在 Panorama 编委名录中的个人页面。",
    "",
    link,
    "",
    `The link works for ${LINK_MINUTES} minutes. If you did not ask for it, you can ignore this email.`,
    `链接 ${LINK_MINUTES} 分钟内有效。如果不是您本人操作，请忽略此邮件。`,
  ].join("\n");
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1b1f24;max-width:520px">
<p>Use the button below to sign in and update or create your profile on the Panorama Scholarly Group Editorial Directory.<br>请点击下面的按钮登录，编辑或新建您在 Panorama 编委名录中的个人页面。</p>
<p><a href="${link}" style="display:inline-block;background:#0e2a47;color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px">Sign in · 登录</a></p>
<p style="color:#5b6470;font-size:13px">The link works for ${LINK_MINUTES} minutes. If you did not ask for it, you can ignore this email.<br>链接 ${LINK_MINUTES} 分钟内有效。如果不是您本人操作，请忽略此邮件。</p></div>`;
  await sendMail(env, { to, subject: "Sign in to edit your profile · 登录编辑个人页面", text, html });
}

async function firstSendIn(key: string, seconds: number): Promise<boolean> {
  // The edge cache is per data centre and best effort, which is enough to
  // stop someone hammering the button.
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) return true;
  const request = new Request(`https://throttle.invalid/${encodeURIComponent(key)}`);
  if (await cache.match(request)) return false;
  await cache.put(request, new Response("1", { headers: { "Cache-Control": `max-age=${seconds}` } }));
  return true;
}

// ---- Session --------------------------------------------------------------

async function signIn(email: string, env: SelfServiceEnv): Promise<Response> {
  const address = email.toLowerCase();
  const repo = await Repo.open(env);
  // No entry and no application yet: an empty slug, filled in on first save.
  const slug = (await findScholar(repo, address)) ?? (await findApplication(repo, address)) ?? "";
  return redirect("/edit", await sessionCookie(address, slug, env));
}

async function sessionCookie(email: string, slug: string, env: SelfServiceEnv): Promise<string> {
  const token = await sign({ p: "session", e: email, s: slug, x: Date.now() + SESSION_HOURS * 3600_000 }, env.SESSION_SECRET!);
  return cookie(SESSION_COOKIE, token, SESSION_HOURS * 3600);
}

async function session(request: Request, env: SelfServiceEnv): Promise<{ email: string; slug: string } | undefined> {
  const claims = await verify(readCookie(request, SESSION_COOKIE) ?? "", env.SESSION_SECRET!);
  if (!claims || claims.p !== "session" || typeof claims.e !== "string" || typeof claims.s !== "string") return undefined;
  return { email: claims.e, slug: claims.s };
}

/** A new entry this address submitted that is still waiting for review. */
async function findApplication(repo: Repo, email: string): Promise<string | undefined> {
  const live = new Set((await repo.readDir(BASE_BRANCH, SCHOLARS_DIR)).map((f) => f.name.replace(/\.md$/, "")));
  for (const pull of await repo.openPulls(BASE_BRANCH)) {
    const slug = pull.head.ref.startsWith("cms/scholars/") ? pull.head.ref.slice("cms/scholars/".length) : "";
    if (!slug || live.has(slug)) continue;
    const text = await repo.readText(pull.head.sha, entryPath(slug));
    if (text && loginEmails(parseEntry(text).data).includes(email)) return slug;
  }
  return undefined;
}

/** The entry on main that lists this address, by file name. */
async function findScholar(repo: Repo, email: string): Promise<string | undefined> {
  const files = await repo.readDir(BASE_BRANCH, SCHOLARS_DIR);
  const match = files
    .filter((f) => f.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .find((f) => loginEmails(parseEntry(f.text).data).includes(email));
  return match?.name.replace(/\.md$/, "");
}

// ---- Editing --------------------------------------------------------------

const entryPath = (slug: string) => `${SCHOLARS_DIR}/${slug}.md`;
const branchFor = (slug: string) => `cms/scholars/${slug}`;

/**
 * The scholar's entry as they should see it: the version waiting for review
 * if there is one, otherwise the live one. Re-checks on every call that the
 * live entry still lists their address, so removing it locks them out.
 *
 * Someone not listed gets their pending application, or a blank new entry
 * (`isNew`) if they have none or it was turned down.
 */
async function current(repo: Repo, who: { email: string; slug: string }) {
  const blank = { data: {} as Data, body: "", text: "", pull: undefined, ref: BASE_BRANCH, isNew: true, slug: "" };
  const live = who.slug ? await repo.readText(BASE_BRANCH, entryPath(who.slug)) : undefined;
  if (live && !loginEmails(parseEntry(live).data).includes(who.email)) return undefined;
  if (!who.slug) return blank;

  const branch = branchFor(who.slug);
  const pull = await repo.openPull(branch, BASE_BRANCH);
  const sha = pull ? await repo.branchSha(branch) : undefined;
  const pending = sha ? await repo.readText(sha, entryPath(who.slug)) : undefined;
  if (!live) {
    if (!pending || !loginEmails(parseEntry(pending).data).includes(who.email)) return blank;
    return { ...parseEntry(pending), text: pending, pull, ref: sha!, isNew: true, slug: who.slug };
  }
  const text = pending || live;
  return { ...parseEntry(text), text, pull, ref: sha ?? BASE_BRANCH, isNew: false, slug: who.slug };
}

async function loadEntry(request: Request, env: SelfServiceEnv): Promise<Response> {
  const who = await session(request, env);
  if (!who) return json({ signedIn: false }, 401);
  const repo = await Repo.open(env);
  const entry = await current(repo, who);
  if (!entry) return json({ signedIn: false, error: "removed" }, 401, clearCookie(SESSION_COOKIE));
  const photo = typeof entry.data.photo === "string" ? entry.data.photo : "";
  return json({
    signedIn: true,
    email: who.email,
    slug: entry.slug || null,
    isNew: entry.isNew,
    data: entry.data,
    body: entry.body,
    adminOnly: ADMIN_ONLY,
    photoUrl: photo.startsWith(PHOTO_PREFIX)
      ? `https://raw.githubusercontent.com/${repo.full}/${entry.ref}/${PHOTOS_DIR}/${encodeURIComponent(photo.slice(PHOTO_PREFIX.length))}`
      : null,
    pending: entry.pull ? { since: entry.pull.updated_at } : null,
  });
}

async function saveEntry(request: Request, url: URL, env: SelfServiceEnv): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_REQUEST_BYTES) return json({ error: "too_large" }, 413);
  const who = await session(request, env);
  if (!who) return json({ error: "signed_out" }, 401);
  const input = (await request.json().catch(() => undefined)) as
    | { data?: Data; body?: unknown; photo?: { base64?: unknown } }
    | undefined;
  if (!input?.data || typeof input.data !== "object") return json({ error: "invalid", message: "Nothing to save." }, 400);

  const repo = await Repo.open(env);
  const entry = await current(repo, who);
  if (!entry) return json({ error: "signed_out" }, 401, clearCookie(SESSION_COOKIE));

  // A new entry starts at the end of the list and remembers who may edit it;
  // its role is the applicant's own wording until the admin confirms it.
  const stored = entry.isNew ? { order: 99, ...entry.data, loginEmails: [who.email] } : entry.data;
  const next = mergeSubmission(stored, input.data);
  if (entry.isNew) next.role = newRole(input.data.role);
  const body = typeof input.body === "string" ? input.body.slice(0, 20_000) : entry.body;
  const files: { path: string; content: string; encoding: "utf-8" | "base64" }[] = [];
  const slug = entry.slug || (await freeSlug(repo, String(next.name)));

  if (input.photo) {
    const photo = checkPhoto(input.photo.base64);
    if (!photo) return json({ error: "invalid", message: "The photo must be a JPEG, PNG or WebP under 5 MB." }, 400);
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const file = `${slug}-${stamp}.${photo.ext}`;
    files.push({ path: `${PHOTOS_DIR}/${file}`, content: photo.base64, encoding: "base64" });
    next.photo = PHOTO_PREFIX + file;
  }

  if (!next.photo) return json({ error: "invalid", message: "Please add a photo." }, 400);

  const text = serializeEntry(next, body);
  if (text === entry.text && !files.length) return json({ ok: true, unchanged: true });
  files.push({ path: entryPath(slug), content: text, encoding: "utf-8" });

  const name = String(next.name);
  const verb = entry.isNew ? "Add" : "Update";
  const { pull } = await repo.commitToPull({
    branch: branchFor(slug),
    base: BASE_BRANCH,
    files,
    message: `${verb} scholar: ${slug} (self-service)\n\nSubmitted by ${name}, signed in as ${mask(who.email)}.`,
    title: `${verb} scholar: ${slug}`,
    body: [
      `Submitted by **${name}** through the self-service editor at /edit (signed in as ${mask(who.email)}).`,
      "",
      entry.isNew
        ? "**New entry.** Anyone with an email address can submit one, so check that this person belongs on the board, and set their position and order, before you press Publish in /admin (Workflow tab) or merge this pull request."
        : "Review the changes, then press Publish in /admin (Workflow tab) or merge this pull request. Admin-only fields (order, role, email, login emails) were kept as they were.",
    ].join("\n"),
    labels: ["decap-cms/pending_review"],
  });
  // The first save of a new entry gives it a slug; keep it in the session.
  const cookies = slug === who.slug ? [] : [await sessionCookie(who.email, slug, env)];
  return json({ ok: true, slug, pending: { since: pull.updated_at } }, 200, ...cookies);
}

function newRole(value: unknown): string {
  const role = typeof value === "string" ? value.trim() : "";
  if (!role || role.length > 200) throw new InvalidEntry("Please enter your position on the board.");
  return role;
}

/** A file name for a new entry, from the name, not used live or pending. */
async function freeSlug(repo: Repo, name: string): Promise<string> {
  const base =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "scholar";
  const live = new Set((await repo.readDir(BASE_BRANCH, SCHOLARS_DIR)).map((f) => f.name.replace(/\.md$/, "")));
  for (let n = 1; n < 50; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!live.has(slug) && !(await repo.branchSha(branchFor(slug)))) return slug;
  }
  throw new InvalidEntry("Could not pick a page address; please write to the editorial office.");
}

function checkPhoto(value: unknown): { base64: string; ext: string } | undefined {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4) return undefined;
  const base64 = value.replace(/^data:[^,]*,/, "");
  let head: Uint8Array;
  try {
    head = Uint8Array.from(atob(base64.slice(0, 24)), (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
  const at = (i: number, ...bytes: number[]) => bytes.every((b, j) => head[i + j] === b);
  if (at(0, 0xff, 0xd8, 0xff)) return { base64, ext: "jpg" };
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { base64, ext: "png" };
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { base64, ext: "webp" };
  return undefined;
}

// ---- Helpers --------------------------------------------------------------

function mask(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 2)}***@${domain}`;
}

// The session cookie is SameSite=Lax, which already keeps other sites from
// posting with it; checking Origin as well costs nothing.
function sameOrigin(request: Request, url: URL): boolean {
  return request.headers.get("Origin") === url.origin;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(claims: Record<string, unknown>, secret: string): Promise<string> {
  const payload = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

async function verify(token: string, secret: string): Promise<Record<string, unknown> | undefined> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return undefined;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), new TextEncoder().encode(payload));
  if (!ok) return undefined;
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Record<string, unknown>;
  return typeof claims.x === "number" && claims.x > Date.now() ? claims : undefined;
}


function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function readCookie(request: Request, name: string): string | undefined {
  return (request.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name: string): string {
  return cookie(name, "", 0);
}

function redirect(location: string, ...cookies: string[]): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

function json(body: unknown, status = 200, ...cookies: string[]): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
}
