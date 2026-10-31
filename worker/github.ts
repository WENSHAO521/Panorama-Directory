// GitHub access for the scholar self-service editor, as a GitHub App.
//
// The Worker signs a short JWT with the app's private key, swaps it for an
// installation token limited to this one repository (contents + pull
// requests), and uses that to read entries and open pull requests. The token
// never leaves the Worker; which files a scholar may touch is decided in
// selfservice.ts before anything here is called.
//
// Needs GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (the .pem GitHub downloads,
// pasted as-is) as secrets, and the app installed on the repository.

export interface GitHubEnv {
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_REPO?: string;
}

export const DEFAULT_REPO = "WENSHAO521/Panorama-Directory";
const API = "https://api.github.com";
const UA = "panorama-directory-selfservice";

let cached: { token: string; expires: number; key: string } | undefined;

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function githubConfigured(env: GitHubEnv): boolean {
  return Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
}

export class Repo {
  readonly owner: string;
  readonly name: string;

  private constructor(
    readonly full: string,
    private readonly token: string,
  ) {
    [this.owner, this.name] = full.split("/");
  }

  static async open(env: GitHubEnv): Promise<Repo> {
    const full = env.GITHUB_REPO ?? DEFAULT_REPO;
    return new Repo(full, await installationToken(env, full));
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": UA,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new GitHubError(`GitHub ${method} ${path}: ${res.status} ${await res.text()}`, res.status);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  /** Every file in a directory with its text, in one GraphQL call. */
  async readDir(ref: string, dir: string): Promise<{ name: string; text: string }[]> {
    const data = await this.request<{
      data?: { repository?: { object?: { entries?: { name: string; object?: { text?: string | null } }[] } } };
    }>("POST", "/graphql", {
      query: `query($owner:String!,$name:String!,$expr:String!){repository(owner:$owner,name:$name){object(expression:$expr){... on Tree{entries{name object{... on Blob{text}}}}}}}`,
      variables: { owner: this.owner, name: this.name, expr: `${ref}:${dir}` },
    });
    return (data.data?.repository?.object?.entries ?? [])
      .filter((e) => typeof e.object?.text === "string")
      .map((e) => ({ name: e.name, text: e.object!.text! }));
  }

  /** A text file's contents at a ref, or undefined if it isn't there. */
  async readText(ref: string, path: string): Promise<string | undefined> {
    try {
      const file = await this.request<{ content: string; encoding: string }>(
        "GET",
        `/repos/${this.full}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
      );
      return utf8FromBase64(file.content);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return undefined;
      throw e;
    }
  }

  async branchSha(branch: string): Promise<string | undefined> {
    try {
      const ref = await this.request<{ object: { sha: string } }>("GET", `/repos/${this.full}/git/ref/heads/${encodePath(branch)}`);
      return ref.object.sha;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return undefined;
      throw e;
    }
  }

  async openPull(branch: string, base: string): Promise<PullRequest | undefined> {
    const pulls = await this.request<PullRequest[]>(
      "GET",
      `/repos/${this.full}/pulls?state=open&base=${encodeURIComponent(base)}&head=${encodeURIComponent(`${this.owner}:${branch}`)}`,
    );
    return pulls[0];
  }

  /**
   * One commit on `branch` with the given files. If the branch has an open
   * pull request the commit goes on top of it; otherwise the branch is
   * (re)started from `base`. Returns the pull request, creating it if needed.
   */
  async commitToPull(opts: {
    branch: string;
    base: string;
    files: { path: string; content: string; encoding: "utf-8" | "base64" }[];
    message: string;
    title: string;
    body: string;
    labels: string[];
  }): Promise<{ pull: PullRequest; created: boolean }> {
    const existing = await this.openPull(opts.branch, opts.base);
    const branchSha = await this.branchSha(opts.branch);
    const parent = existing && branchSha ? branchSha : await this.branchSha(opts.base);
    if (!parent) throw new GitHubError(`Branch ${opts.base} not found`, 404);

    const parentCommit = await this.request<{ tree: { sha: string } }>("GET", `/repos/${this.full}/git/commits/${parent}`);
    const tree = await Promise.all(
      opts.files.map(async (f) => {
        const blob = await this.request<{ sha: string }>("POST", `/repos/${this.full}/git/blobs`, {
          content: f.content,
          encoding: f.encoding,
        });
        return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
      }),
    );
    const newTree = await this.request<{ sha: string }>("POST", `/repos/${this.full}/git/trees`, {
      base_tree: parentCommit.tree.sha,
      tree,
    });
    const commit = await this.request<{ sha: string }>("POST", `/repos/${this.full}/git/commits`, {
      message: opts.message,
      tree: newTree.sha,
      parents: [parent],
    });

    if (branchSha) {
      // force: a leftover branch without an open pull request is restarted from base.
      await this.request("PATCH", `/repos/${this.full}/git/refs/heads/${encodePath(opts.branch)}`, { sha: commit.sha, force: true });
    } else {
      await this.request("POST", `/repos/${this.full}/git/refs`, { ref: `refs/heads/${opts.branch}`, sha: commit.sha });
    }
    if (existing) return { pull: existing, created: false };

    const pull = await this.request<PullRequest>("POST", `/repos/${this.full}/pulls`, {
      title: opts.title,
      body: opts.body,
      head: opts.branch,
      base: opts.base,
    });
    await this.request("POST", `/repos/${this.full}/issues/${pull.number}/labels`, { labels: opts.labels });
    return { pull, created: true };
  }
}

export interface PullRequest {
  number: number;
  html_url: string;
  updated_at: string;
}

async function installationToken(env: GitHubEnv, repo: string): Promise<string> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) throw new GitHubError("GitHub App is not configured", 500);
  const key = `${env.GITHUB_APP_ID}:${repo}`;
  if (cached && cached.key === key && cached.expires > Date.now() + 5 * 60_000) return cached.token;

  const jwt = await appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const appRequest = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "User-Agent": UA },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new GitHubError(`GitHub App ${path}: ${res.status} ${await res.text()}`, res.status);
    return (await res.json()) as T;
  };
  const installation = await appRequest<{ id: number }>("GET", `/repos/${repo}/installation`);
  const token = await appRequest<{ token: string; expires_at: string }>(
    "POST",
    `/app/installations/${installation.id}/access_tokens`,
    { repositories: [repo.split("/")[1]], permissions: { contents: "write", pull_requests: "write" } },
  );
  cached = { token: token.token, expires: Date.parse(token.expires_at), key };
  return token.token;
}

async function appJwt(appId: string, pem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // iat is backdated a minute to allow for clock drift, as GitHub suggests.
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const key = await crypto.subtle.importKey("pkcs8", pkcs8(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

/**
 * GitHub hands out PKCS#1 keys ("BEGIN RSA PRIVATE KEY"); WebCrypto only
 * imports PKCS#8, so wrap the former in the latter's ASN.1 envelope.
 */
function pkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const text = pem.replace(/\\n/g, "\n");
  const der = Uint8Array.from(atob(text.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  if (!text.includes("BEGIN RSA PRIVATE KEY")) return der;
  const rsaAlgorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const inner = [0x02, 0x01, 0x00, ...rsaAlgorithm, 0x04, ...derLength(der.length), ...der];
  return new Uint8Array([0x30, ...derLength(inner.length), ...inner]);
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

export function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function utf8FromBase64(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0)));
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
