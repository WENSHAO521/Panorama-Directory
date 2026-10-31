// Reading and writing one scholar entry (src/content/scholars/<slug>.md) for
// the self-service editor. The shape mirrors src/content.config.ts and
// public/admin/config.yml; keep the three in sync.
import { parse, stringify } from "yaml";

export type Data = Record<string, unknown>;

export const SCHOLARS_DIR = "src/content/scholars";
export const PHOTOS_DIR = "src/assets/scholars";
export const PHOTO_PREFIX = "../../assets/scholars/";

/**
 * Fields only the admin may change: they decide who can sign in for this
 * entry and where it is listed. Whatever a scholar submits for them is
 * replaced by the stored value.
 */
export const ADMIN_ONLY = ["order", "role", "email", "loginEmails", "photo"] as const;

// Frontmatter key order, so a self-service save diffs cleanly against a
// Decap save.
const KEY_ORDER = [
  "name",
  "nativeName",
  "order",
  "role",
  "affiliation",
  "headline",
  "photo",
  "summary",
  "keywords",
  "email",
  "loginEmails",
  "identifiers",
  "sections",
];

export function parseEntry(text: string): { data: Data; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: text };
  const data = parse(match[1]);
  return { data: data && typeof data === "object" ? (data as Data) : {}, body: match[2].replace(/^\r?\n/, "") };
}

export function serializeEntry(data: Data, body: string): string {
  const ordered: Data = {};
  for (const key of KEY_ORDER) if (data[key] !== undefined) ordered[key] = data[key];
  const yaml = stringify(ordered, { lineWidth: 80 });
  return `---\n${yaml}---\n${body.trim()}\n`;
}

/** Every address that may sign in for this entry, lower-cased. */
export function loginEmails(data: Data): string[] {
  const all = [data.email, ...(Array.isArray(data.loginEmails) ? data.loginEmails : [])];
  return all.filter((e): e is string => typeof e === "string" && e.includes("@")).map((e) => e.trim().toLowerCase());
}

export class InvalidEntry extends Error {}

// What a scholar can submit. Anything not listed here is dropped; anything
// of the wrong type is rejected. Limits are generous but stop runaway input.
const str = (v: unknown, field: string, { required = false, max = 2000 } = {}): string | undefined => {
  if (v === undefined || v === null || v === "") {
    if (required) throw new InvalidEntry(`${field} is required`);
    return undefined;
  }
  if (typeof v !== "string") throw new InvalidEntry(`${field} must be text`);
  const s = v.trim();
  if (s.length > max) throw new InvalidEntry(`${field} is too long`);
  if (!s && required) throw new InvalidEntry(`${field} is required`);
  return s || undefined;
};
const strList = (v: unknown, field: string, max = 50): string[] | undefined => {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > max) throw new InvalidEntry(`${field} must be a list`);
  const out = v.map((x, i) => str(x, `${field}[${i}]`)).filter((x): x is string => Boolean(x));
  return out.length ? out : undefined;
};
const objList = <T>(v: unknown, field: string, each: (x: Data, at: string) => T, max = 200): T[] | undefined => {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > max) throw new InvalidEntry(`${field} must be a list`);
  const out = v.map((x, i) => {
    if (!x || typeof x !== "object") throw new InvalidEntry(`${field}[${i}] is invalid`);
    return each(x as Data, `${field}[${i}]`);
  });
  return out.length ? out : undefined;
};
const url = (v: unknown, field: string): string | undefined => {
  const s = str(v, field);
  if (s && !/^https?:\/\/\S+$/.test(s)) throw new InvalidEntry(`${field} must start with http:// or https://`);
  return s;
};
const compact = <T extends Data>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function publication(x: Data, at: string): Data {
  const href = url((x.link as Data | undefined)?.href, `${at}.link.href`);
  return compact({
    type: "publication",
    label: str(x.label, `${at}.label`, { required: true, max: 40 }),
    title: str(x.title, `${at}.title`, { required: true }),
    authors: str(x.authors, `${at}.authors`),
    venue: str(x.venue, `${at}.venue`),
    link: href ? { href, text: str((x.link as Data).text, `${at}.link.text`) ?? href } : undefined,
  });
}

function card(x: Data, at: string): Data {
  return compact({
    type: "card",
    icon: str(x.icon, `${at}.icon`, { max: 60 }),
    title: str(x.title, `${at}.title`, { required: true }),
    meta: strList(x.meta, `${at}.meta`),
    text: strList(x.text, `${at}.text`),
    list: strList(x.list, `${at}.list`, 100),
    entries: objList(x.entries, `${at}.entries`, (e, a) => ({
      title: str(e.title, `${a}.title`, { required: true })!,
      meta: str(e.meta, `${a}.meta`, { required: true })!,
    })),
    centered: x.centered === true ? true : undefined,
  });
}

function section(x: Data, at: string): Data {
  const layout = x.layout === "grid" ? "grid" : "list";
  const columns = x.columns === 2 || x.columns === 3 ? x.columns : undefined;
  return compact({
    eyebrow: str(x.eyebrow, `${at}.eyebrow`, { max: 200 }),
    title: str(x.title, `${at}.title`, { max: 200 }),
    layout,
    columns: layout === "grid" ? columns : undefined,
    compact: x.compact === true ? true : undefined,
    items:
      objList(x.items, `${at}.items`, (item, a) => {
        if (item.type === "publication") return publication(item, a);
        if (item.type === "card") return card(item, a);
        throw new InvalidEntry(`${a}.type must be publication or card`);
      }) ?? [],
  });
}

/**
 * The entry as it will be saved: the scholar's edits, cleaned, with every
 * admin-only field copied from `stored`.
 */
export function mergeSubmission(stored: Data, submitted: Data): Data {
  const next: Data = compact({
    name: str(submitted.name, "name", { required: true, max: 200 }),
    nativeName: str(submitted.nativeName, "nativeName", { max: 200 }),
    affiliation: str(submitted.affiliation, "affiliation", { required: true, max: 500 }),
    headline: str(submitted.headline, "headline", { max: 500 }),
    summary: str(submitted.summary, "summary", { required: true, max: 3000 }),
    keywords: strList(submitted.keywords, "keywords") ?? [],
    identifiers: objList(submitted.identifiers, "identifiers", (x, at) => ({
      label: str(x.label, `${at}.label`, { required: true, max: 100 })!,
      value: str(x.value, `${at}.value`, { required: true, max: 200 })!,
      href: url(x.href, `${at}.href`) ?? (() => { throw new InvalidEntry(`${at}.href is required`); })(),
    })),
    sections: objList(submitted.sections, "sections", section, 30),
  });
  for (const key of ADMIN_ONLY) if (stored[key] !== undefined) next[key] = stored[key];
  return next;
}
