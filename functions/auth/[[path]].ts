// Cloudflare Pages Function: the scholar sign-in routes from worker/selfservice.ts,
// for when the site is deployed through Cloudflare Pages instead of Workers.
import { handleSelfService, type SelfServiceEnv } from "../../worker/selfservice";

export const onRequest = ({ request, env }: { request: Request; env: SelfServiceEnv }) => handleSelfService(request, env);
