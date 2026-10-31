// Cloudflare Pages Function: the /api/lookup route from worker/lookup.ts,
// for when the site is deployed through Cloudflare Pages instead of Workers.
import { handleLookup } from "../../worker/lookup";

export const onRequest = ({ request }: { request: Request }) => handleLookup(request);
