// Publication lookup for the editors (/edit and /admin), like adding works
// on ORCID: GET /api/lookup?doi=… returns one publication row filled in from
// Crossref (or DataCite, for DOIs Crossref does not hold), and
// GET /api/lookup?orcid=… lists the public works on an ORCID record so the
// scholar can pick which to add.
//
// Both are read-only and only ever call these fixed public APIs, so no
// sign-in is needed. Done here rather than in the browser so it does not
// depend on each API's CORS settings, and so Crossref sees a contact address
// (its "polite pool").

const USER_AGENT = "PanoramaDirectory/1.0 (https://profiles.panorama-sg.com; mailto:directory.admin@panorama-sg.com)";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Longer author lists are cut to this many names plus "et al.".
const MAX_AUTHORS = 10;

type Json = Record<string, any>;

export interface Publication {
  type: "publication";
  label: string;
  title: string;
  authors?: string;
  venue?: string;
  link?: { href: string; text: string };
}

export interface OrcidWork {
  title: string;
  year?: string;
  venue?: string;
  doi?: string;
  url?: string;
  /** Row to add when the work has no DOI to look up. */
  item: Publication;
}

export function isLookupPath(pathname: string): boolean {
  return pathname === "/api/lookup";
}

export async function handleLookup(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method" }, 405);
  const params = new URL(request.url).searchParams;
  try {
    if (params.has("doi")) {
      const doi = normalizeDoi(params.get("doi")!);
      if (!doi) return json({ error: "invalid", message: "That does not look like a DOI (it starts with 10.)." }, 400);
      const item = (await fromCrossref(doi)) ?? (await fromDataCite(doi));
      return item ? json({ ok: true, item }, 200, 86400) : json({ error: "not_found", message: `No record found for DOI ${doi}.` }, 404);
    }
    if (params.has("orcid")) {
      const id = normalizeOrcid(params.get("orcid")!);
      if (!id) return json({ error: "invalid", message: "An ORCID iD looks like 0000-0002-1825-0097." }, 400);
      const works = await fromOrcid(id);
      return works ? json({ ok: true, orcid: id, works }, 200, 600) : json({ error: "not_found", message: `No public ORCID record ${id}.` }, 404);
    }
    return json({ error: "invalid", message: "Pass ?doi= or ?orcid=" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "upstream", message: "The lookup service did not answer. Please try again, or fill the fields in by hand." }, 502);
  }
}

/** Accepts a bare DOI, "doi:…", or any doi.org / dx.doi.org link. */
export function normalizeDoi(input: string): string | undefined {
  let s = input.trim();
  try {
    s = decodeURIComponent(s);
  } catch {}
  s = s.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim();
  return /^10\.\d{4,9}\/\S+$/.test(s) ? s : undefined;
}

/** Accepts a bare iD or an orcid.org link; checks the ISO 7064 check digit. */
export function normalizeOrcid(input: string): string | undefined {
  const m = input.trim().match(/(\d{4})-?(\d{4})-?(\d{4})-?(\d{3}[\dXx])\/?$/);
  if (!m) return undefined;
  const digits = m.slice(1).join("").toUpperCase();
  let total = 0;
  for (const c of digits.slice(0, 15)) total = (total + Number(c)) * 2;
  const check = (12 - (total % 11)) % 11;
  if (digits[15] !== (check === 10 ? "X" : String(check))) return undefined;
  return digits.match(/.{4}/g)!.join("-");
}

async function getJson(url: string, accept = "application/json"): Promise<Json | undefined> {
  const res = await fetch(url, { headers: { Accept: accept, "User-Agent": USER_AGENT } });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return (await res.json()) as Json;
}

// DOIs may contain "/" and other characters; keep the slashes readable.
const doiPath = (doi: string) => doi.split("/").map(encodeURIComponent).join("/");

async function fromCrossref(doi: string): Promise<Publication | undefined> {
  const m = (await getJson(`https://api.crossref.org/works/${doiPath(doi)}`))?.message as Json | undefined;
  if (!m) return undefined;
  const date: number[] | undefined = (m.published ?? m.issued ?? m["published-print"] ?? m["published-online"])?.["date-parts"]?.[0];
  const title = [first(m.title), first(m.subtitle)].filter(Boolean).join(": ");
  // A chapter's container is the book; a book has none, so name the publisher.
  const container = first(m["container-title"]) ?? (m.type === "book" || m.type === "monograph" || m.type === "edited-book" ? m.publisher : undefined);
  const people: Json[] = m.author ?? m.editor ?? [];
  return row({
    doi,
    title,
    authors: people.map((p) => (p.family ? [p.family, p.given].filter(Boolean).join(", ") : p.name)).filter(Boolean),
    venue: container,
    year: date?.[0],
    month: date?.[1],
  });
}

async function fromDataCite(doi: string): Promise<Publication | undefined> {
  const a = (await getJson(`https://api.datacite.org/dois/${doiPath(doi)}`, "application/vnd.api+json"))?.data?.attributes as Json | undefined;
  if (!a) return undefined;
  const issued: string | undefined = (a.dates as Json[] | undefined)?.find((d) => d.dateType === "Issued")?.date;
  const month = issued?.match(/^\d{4}-(\d{2})/)?.[1];
  const publisher = typeof a.publisher === "string" ? a.publisher : a.publisher?.name;
  return row({
    doi,
    title: (a.titles as Json[] | undefined)?.find((t) => !t.titleType)?.title ?? a.titles?.[0]?.title,
    authors: ((a.creators as Json[] | undefined) ?? []).map((c) => (c.familyName ? [c.familyName, c.givenName].filter(Boolean).join(", ") : c.name)).filter(Boolean),
    venue: a.container?.title ?? publisher,
    year: a.publicationYear,
    month: month ? Number(month) : undefined,
  });
}

async function fromOrcid(id: string): Promise<OrcidWork[] | undefined> {
  const data = await getJson(`https://pub.orcid.org/v3.0/${id}/works`);
  if (!data) return undefined;
  const works: OrcidWork[] = [];
  for (const group of (data.group as Json[] | undefined) ?? []) {
    // ORCID groups copies of one work from several sources; the first is the
    // one the scholar marked as preferred.
    const w = group["work-summary"]?.[0] as Json | undefined;
    if (!w) continue;
    const ids: Json[] = w["external-ids"]?.["external-id"] ?? group["external-ids"]?.["external-id"] ?? [];
    const doiId = ids.find((x) => x["external-id-type"] === "doi");
    const doi = doiId ? normalizeDoi(doiId["external-id-value"] ?? doiId["external-id-normalized"]?.value ?? "") : undefined;
    const date = w["publication-date"];
    const year = date?.year?.value;
    const month = date?.month?.value ? Number(date.month.value) : undefined;
    const title = [w.title?.title?.value, w.title?.subtitle?.value].filter(Boolean).join(": ");
    const venue = w["journal-title"]?.value;
    const url = w.url?.value ?? ids.find((x) => x["external-id-url"]?.value)?.["external-id-url"]?.value;
    const item = row({ doi, title, authors: [], venue, year, month, url });
    if (!item) continue;
    works.push({ title: item.title, year, venue: venue ? clean(venue) : undefined, doi, url, item });
  }
  return works;
}

/** Builds a row in the site's citation style (see src/content/scholars). */
function row(x: { doi?: string; title?: string; authors: string[]; venue?: string; year?: number | string; month?: number; url?: string }): Publication | undefined {
  const title = clean(x.title ?? "");
  if (!title) return undefined;
  const year = x.year ? String(x.year) : "";
  const when = [x.month && MONTHS[x.month - 1], year].filter(Boolean).join(" ");
  // "Journal (Feb 2026)"; with no journal the year label says enough.
  const venue = x.venue && clean(x.venue) ? [clean(x.venue), when && `(${when})`].filter(Boolean).join(" ") : "";
  const names = x.authors.map(clean).filter(Boolean);
  const authors = names.length > MAX_AUTHORS ? `${names.slice(0, MAX_AUTHORS).join("; ")} et al.` : names.join("; ");
  const href = x.doi ? `https://doi.org/${x.doi}` : x.url && /^https?:\/\//.test(x.url) ? x.url : undefined;
  return {
    type: "publication",
    label: year || "Forthcoming",
    title,
    ...(authors ? { authors } : {}),
    ...(venue ? { venue } : {}),
    ...(href ? { link: { href, text: x.doi ? `DOI: ${x.doi}` : "View article" } } : {}),
  };
}

const first = (v: unknown): string | undefined => (Array.isArray(v) ? v.find((s) => typeof s === "string" && s.trim()) : undefined);

/** Crossref titles can carry JATS/HTML markup (<i>, <sub>) and entities. */
function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " })[e]!)
    .replace(/\s+/g, " ")
    .trim();
}

function json(body: unknown, status = 200, maxAge = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}
