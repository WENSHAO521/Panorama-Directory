// Cloudflare Pages Function: the same GitHub sign-in routes as worker/index.ts,
// for when the site is deployed through Cloudflare Pages instead of Workers.
import { handleOAuth, type OAuthEnv } from "../../worker/oauth";

export const onRequest = ({ request, env }: { request: Request; env: OAuthEnv }) => handleOAuth(request, env);
