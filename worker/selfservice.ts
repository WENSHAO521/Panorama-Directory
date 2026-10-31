// Self-service editing for scholars at /edit.
//
// A scholar proves they own an address listed in their entry (`email` or
// `loginEmails`, set by the admin), either by signing in with Google or by
// clicking a one-time link mailed to that address. They can then edit their
// own entry only. Each save is committed by the GitHub App to the Decap
// branch for that entry (cms/scholars/<slug>) and labelled "pending review",
// so it shows up in the /admin editorial workflow and goes live only when
// the admin publishes it. Admin-only fields (see ADMIN_ONLY) are never taken
// from the scholar.
//
// No database: sessions and login links are HMAC-signed with SESSION_SECRET.
//
// Secrets: SESSION_SECRET, GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (Google
// sign-in), the Alibaba Cloud DirectMail ones in mail.ts (login links), and
// the GitHub App ones in github.ts. Either sign-in method can be left out.
import { ADMIN_ONLY, InvalidEntry, loginEmails, mergeSubmission, parseEntry, PHOTO_PREFIX, PHOTOS_DIR, SCHOLARS_DIR, serializeEntry, type Data } from "./entry";
import { b64url, githubConfigured, GitHubError, Repo, type GitHubEnv } from "./github";
import { mailConfigured, sendMail, type MailEnv } from "./mail";

export interface SelfServiceEnv extends GitHubEnv, MailEnv {
  SESSION_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

const SESSION_COOKIE = "__Host-pd_session";
const STATE_COOKIE = "__Host-pd_google_state";
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
    if (!env.SESSION_SECRET || !githubConfigured(env)) {
      return request.method === "GET" && url.pathname.startsWith("/auth/")
        ? redirect("/edit?error=not_configured")
        : json({ error: "not_configured", methods: { google: false, email: false } }, 503);
    }
    switch (route) {
      case "GET /auth/google":
        return googleStart(url, env);
      case "GET /auth/google/callback":
        return await googleFinish(request, url, env);
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
    return json({ error: "server", message: e instanceof GitHubError ? "GitHub request failed" : "Unexpected error" }, 500);
  }
}

// ---- Google sign-in -------------------------------------------------------

function googleStart(url: URL, env: SelfServiceEnv): Response {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return redirect("/edit?error=google_off");
  const state = crypto.randomUUID();
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  google.searchParams.set("redirect_uri", `${url.origin}/auth/google/callback`);
  google.searchParams.set("response_type", "code");
  google.searchParams.set("scope", "openid email");
  google.searchParams.set("state", state);
  google.searchParams.set("prompt", "select_account");
  return redirect(google.toString(), cookie(STATE_COOKIE, state, 600));
}

async function googleFinish(request: Request, url: URL, env: SelfServiceEnv): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== readCookie(request, STATE_COOKIE)) return redirect("/edit?error=expired");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${url.origin}/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  const token = (await res.json().catch(() => ({}))) as { id_token?: string };
  // The ID token came straight from Google over TLS in exchange for our
  // client secret, so its claims can be trusted without checking the
  // signature (Google's OpenID Connect docs allow this).
  const claims = token.id_token ? decodeJwtPayload(token.id_token) : undefined;
  if (
    !claims ||
    claims.aud !== env.GOOGLE_CLIENT_ID ||
    !["accounts.google.com", "https://accounts.google.com"].includes(String(claims.iss)) ||
    claims.email_verified !== true ||
    typeof claims.email !== "string"
  ) {
    return redirect("/edit?error=google_failed", clearCookie(STATE_COOKIE));
  }
  return signIn(claims.email, env, [clearCookie(STATE_COOKIE)]);
}

// ---- One-time login link by email ----------------------------------------

async function emailStart(request: Request, url: URL, env: SelfServiceEnv): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);
  if (!mailConfigured(env)) return json({ error: "email_off" }, 503);
  const { email } = (await request.json().catch(() => ({}))) as { email?: unknown };
  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
    return json({ error: "invalid", message: "Please enter a valid email address." }, 400);
  }
  const address = email.trim().toLowerCase();

  // The reply is the same whether or not the address belongs to a scholar,
  // so the form can't be used to find out who is listed. Only listed
  // addresses get mail, at most once a minute each.
  const repo = await Repo.open(env);
  const slug = await findScholar(repo, address);
  if (slug && (await firstSendInAMinute(address))) {
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
    "Use the link below to sign in and update your profile on the Panorama Scholarly Group Editorial Directory.",
    "请点击下面的链接登录，编辑您在 Panorama 编委名录中的个人页面。",
    "",
    link,
    "",
    `The link works for ${LINK_MINUTES} minutes. If you did not ask for it, you can ignore this email.`,
    `链接 ${LINK_MINUTES} 分钟内有效。如果不是您本人操作，请忽略此邮件。`,
  ].join("\n");
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1b1f24;max-width:520px">
<p>Use the button below to sign in and update your profile on the Panorama Scholarly Group Editorial Directory.<br>请点击下面的按钮登录，编辑您在 Panorama 编委名录中的个人页面。</p>
<p><a href="${link}" style="display:inline-block;background:#0e2a47;color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px">Sign in · 登录</a></p>
<p style="color:#5b6470;font-size:13px">The link works for ${LINK_MINUTES} minutes. If you did not ask for it, you can ignore this email.<br>链接 ${LINK_MINUTES} 分钟内有效。如果不是您本人操作，请忽略此邮件。</p></div>`;
  await sendMail(env, { to, subject: "Sign in to edit your profile · 登录编辑个人页面", text, html });
}

async function firstSendInAMinute(address: string): Promise<boolean> {
  // The edge cache is per data centre and best effort, which is enough to
  // stop someone hammering the button.
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) return true;
  const key = new Request(`https://throttle.invalid/${encodeURIComponent(address)}`);
  if (await cache.match(key)) return false;
  await cache.put(key, new Response("1", { headers: { "Cache-Control": "max-age=60" } }));
  return true;
}

// ---- Session --------------------------------------------------------------

async function signIn(email: string, env: SelfServiceEnv, extraCookies: string[] = []): Promise<Response> {
  const address = email.toLowerCase();
  const slug = await findScholar(await Repo.open(env), address);
  if (!slug) return redirect(`/edit?error=no_match`, ...extraCookies);
  const session = await sign({ p: "session", e: address, s: slug, x: Date.now() + SESSION_HOURS * 3600_000 }, env.SESSION_SECRET!);
  return redirect("/edit", ...extraCookies, cookie(SESSION_COOKIE, session, SESSION_HOURS * 3600));
}

async function session(request: Request, env: SelfServiceEnv): Promise<{ email: string; slug: string } | undefined> {
  const claims = await verify(readCookie(request, SESSION_COOKIE) ?? "", env.SESSION_SECRET!);
  if (!claims || claims.p !== "session" || typeof claims.e !== "string" || typeof claims.s !== "string") return undefined;
  return { email: claims.e, slug: claims.s };
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
 */
async function current(repo: Repo, who: { email: string; slug: string }) {
  const live = await repo.readText(BASE_BRANCH, entryPath(who.slug));
  if (!live || !loginEmails(parseEntry(live).data).includes(who.email)) return undefined;
  const branch = branchFor(who.slug);
  const pull = await repo.openPull(branch, BASE_BRANCH);
  const sha = pull ? await repo.branchSha(branch) : undefined;
  const text = (sha && (await repo.readText(sha, entryPath(who.slug)))) || live;
  return { ...parseEntry(text), text, pull, ref: sha ?? BASE_BRANCH };
}

async function loadEntry(request: Request, env: SelfServiceEnv): Promise<Response> {
  const who = await session(request, env);
  if (!who) return json({ signedIn: false, methods: methods(env) }, 401);
  const repo = await Repo.open(env);
  const entry = await current(repo, who);
  if (!entry) return json({ signedIn: false, methods: methods(env), error: "no_match" }, 401, clearCookie(SESSION_COOKIE));
  const photo = typeof entry.data.photo === "string" ? entry.data.photo : "";
  return json({
    signedIn: true,
    email: who.email,
    slug: who.slug,
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

  const next = mergeSubmission(entry.data, input.data);
  const body = typeof input.body === "string" ? input.body.slice(0, 20_000) : entry.body;
  const files: { path: string; content: string; encoding: "utf-8" | "base64" }[] = [];

  if (input.photo) {
    const photo = checkPhoto(input.photo.base64);
    if (!photo) return json({ error: "invalid", message: "The photo must be a JPEG, PNG or WebP under 5 MB." }, 400);
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const file = `${who.slug}-${stamp}.${photo.ext}`;
    files.push({ path: `${PHOTOS_DIR}/${file}`, content: photo.base64, encoding: "base64" });
    next.photo = PHOTO_PREFIX + file;
  }

  const text = serializeEntry(next, body);
  if (text === entry.text && !files.length) return json({ ok: true, unchanged: true });
  files.push({ path: entryPath(who.slug), content: text, encoding: "utf-8" });

  const name = String(next.name);
  const { pull } = await repo.commitToPull({
    branch: branchFor(who.slug),
    base: BASE_BRANCH,
    files,
    message: `Update scholar: ${who.slug} (self-service)\n\nSubmitted by ${name}, signed in as ${mask(who.email)}.`,
    title: `Update scholar: ${who.slug}`,
    body: [
      `Submitted by **${name}** through the self-service editor at /edit (signed in as ${mask(who.email)}).`,
      "",
      "Review the changes, then press Publish in /admin (Workflow tab) or merge this pull request. Admin-only fields (order, role, email, login emails) were kept as they were.",
    ].join("\n"),
    labels: ["decap-cms/pending_review"],
  });
  return json({ ok: true, pending: { since: pull.updated_at } });
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

function methods(env: SelfServiceEnv) {
  return { google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), email: mailConfigured(env) };
}

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

function decodeJwtPayload(jwt: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(new TextDecoder().decode(fromB64url(jwt.split(".")[1])));
  } catch {
    return undefined;
  }
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
