// Worker entry: serves the static site from dist/ and adds the GitHub
// sign-in routes used by the /admin editor and the scholar self-service
// routes used by /edit.
import { handleOAuth, type OAuthEnv } from "./oauth";
import { handleSelfService, isSelfServicePath, type SelfServiceEnv } from "./selfservice";

interface Env extends OAuthEnv, SelfServiceEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/oauth/")) return handleOAuth(request, env);
    if (isSelfServicePath(pathname)) return handleSelfService(request, env);
    return env.ASSETS.fetch(request);
  },
};
