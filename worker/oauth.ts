// GitHub sign-in for the Decap CMS editor at /admin.
//
// Decap opens /oauth/auth in a popup; we send the user to GitHub, GitHub
// returns to /oauth/callback with a code, we swap it for a token using the
// app secret (which must never reach the browser) and hand the token back to
// the editor window with postMessage.
//
// Needs two secrets on the Cloudflare project: GITHUB_CLIENT_ID and
// GITHUB_CLIENT_SECRET, from a GitHub OAuth App whose callback URL is
// https://<site>/oauth/callback.
//
// Only the GitHub accounts listed in ALLOWED_GITHUB_USERS (comma-separated,
// set in wrangler.jsonc) are handed a token. Anyone else is turned away and
// the token GitHub issued them is revoked. An empty list lets nobody in.

export interface OAuthEnv {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  ALLOWED_GITHUB_USERS?: string;
}

const STATE_COOKIE = "__Host-decap_oauth_state";

export async function handleOAuth(request: Request, env: OAuthEnv): Promise<Response> {
  const url = new URL(request.url);
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return reply("error", { message: "GitHub sign-in is not configured on the server." }, url.origin);
  }
  if (url.pathname === "/oauth/auth") return start(url, env.GITHUB_CLIENT_ID);
  if (url.pathname === "/oauth/callback") return finish(request, url, env);
  return new Response("Not found", { status: 404 });
}

function start(url: URL, clientId: string): Response {
  const state = crypto.randomUUID();
  // Decap asks for "repo" (private repos) or "public_repo"; allow nothing wider.
  const scope = url.searchParams.get("scope") === "public_repo" ? "public_repo" : "repo";
  const github = new URL("https://github.com/login/oauth/authorize");
  github.searchParams.set("client_id", clientId);
  github.searchParams.set("redirect_uri", `${url.origin}/oauth/callback`);
  github.searchParams.set("scope", scope);
  github.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: github.toString(),
      "Set-Cookie": `${STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

async function finish(request: Request, url: URL, env: OAuthEnv): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookie = request.headers.get("Cookie") ?? "";
  const expected = cookie.match(new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`))?.[1];
  if (!code || !state || state !== expected) {
    return reply("error", { message: "Sign-in expired or was tampered with. Please try again." }, url.origin);
  }

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "panorama-directory-cms" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/oauth/callback`,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!data.access_token) {
    return reply("error", { message: data.error_description ?? "GitHub did not return a token." }, url.origin);
  }

  const login = await githubLogin(data.access_token);
  if (!login || !allowedUsers(env).has(login.toLowerCase())) {
    await revokeToken(data.access_token, env);
    return reply("error", { message: `GitHub account ${login ?? "(unknown)"} is not allowed to edit this site.` }, url.origin);
  }
  return reply("success", { token: data.access_token, provider: "github" }, url.origin);
}

function allowedUsers(env: OAuthEnv): Set<string> {
  return new Set(
    (env.ALLOWED_GITHUB_USERS ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function githubLogin(token: string): Promise<string | undefined> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "panorama-directory-cms" },
  });
  if (!res.ok) return undefined;
  const user = (await res.json().catch(() => ({}))) as { login?: string };
  return user.login;
}

// Best effort: a rejected account's token is never sent to the browser, but
// revoking it means it isn't left valid on GitHub either.
async function revokeToken(token: string, env: OAuthEnv): Promise<void> {
  await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "panorama-directory-cms",
    },
    body: JSON.stringify({ access_token: token }),
  }).catch(() => undefined);
}

/**
 * The popup page that talks to the editor. Decap first sends
 * "authorizing:github"; we answer only a window on our own origin, so the
 * token can't be handed to another site that opened this popup.
 */
function reply(status: "success" | "error", content: object, origin: string): Response {
  const message = JSON.stringify(`authorization:github:${status}:${JSON.stringify(content)}`);
  const html = `<!doctype html><meta charset="utf-8"><title>Signing in…</title>
<p>${status === "success" ? "Signed in. You can close this window." : "Sign-in failed. You can close this window and try again."}</p>
<script>
  const origin = ${JSON.stringify(origin)};
  window.addEventListener("message", (e) => {
    if (e.origin !== origin) return;
    window.opener.postMessage(${message}, origin);
  });
  if (window.opener) window.opener.postMessage("authorizing:github", origin);
</script>`;
  return new Response(html, {
    status: status === "success" ? 200 : 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
}
