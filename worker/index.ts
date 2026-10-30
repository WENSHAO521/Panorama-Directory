// Worker entry: serves the static site from dist/ and adds the two GitHub
// sign-in routes used by the /admin editor.
import { handleOAuth, type OAuthEnv } from "./oauth";

interface Env extends OAuthEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/oauth/")) return handleOAuth(request, env);
    return env.ASSETS.fetch(request);
  },
};
