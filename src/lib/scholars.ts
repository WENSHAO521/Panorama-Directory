import { getCollection, type CollectionEntry } from "astro:content";

export type Scholar = CollectionEntry<"scholars">;

/** All scholars, alphabetical by name. */
export async function getScholars(): Promise<Scholar[]> {
  const all = await getCollection("scholars");
  return all.sort((a, b) => a.data.name.localeCompare(b.data.name));
}

/** Scholars in the editorially chosen order used for "Featured". */
export async function getFeatured(count: number): Promise<Scholar[]> {
  const all = await getCollection("scholars");
  return all.sort((a, b) => a.data.order - b.data.order).slice(0, count);
}

export const profileUrl = (s: Scholar) => `/board/${s.id}`;

/** First letters of first and last name, used by the A–Z filter. */
export function nameInitials(name: string): string[] {
  const parts = name.replace(/\(.*?\)/g, " ").trim().split(/\s+/);
  return [...new Set([parts[0], parts.at(-1)!].map((p) => p[0].toUpperCase()))];
}

export function publicationCount(s: Scholar): number {
  return s.data.sections.reduce(
    (n, sec) => n + sec.items.filter((i) => i.type === "publication").length,
    0,
  );
}

/** Minimal inline Markdown: *italic* only, with HTML escaped. */
export function inline(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

/** Editorial board tiers, in display order, and the roles that belong to each. */
export const TIERS = [
  { key: "chief", title: "Editors-in-chief", match: /editor-in-chief/i },
  { key: "executive", title: "Executive editorial board", match: /^executive editorial board/i },
  { key: "board", title: "Editorial board", match: /editorial board member|chair of the editorial board/i },
  { key: "office", title: "Editorial office and research", match: /./ },
] as const;

export type TierKey = (typeof TIERS)[number]["key"];

export function tierOf(s: Scholar): TierKey {
  return TIERS.find((t) => t.match.test(s.data.role))!.key;
}

/** Rank within the chief tier: Editor-in-Chief, then Co-, then Deputy. */
function roleRank(role: string): number {
  if (/^(editor-in-chief|chair of the)/i.test(role)) return 0;
  if (/^co-editor/i.test(role)) return 1;
  if (/^deputy/i.test(role)) return 2;
  return 3;
}

/** Scholars grouped by tier, each group sorted by role rank then name. */
export async function getBoard() {
  const all = await getScholars();
  return TIERS.map((t) => ({
    ...t,
    members: all
      .filter((s) => tierOf(s) === t.key)
      .sort((a, b) => roleRank(a.data.role) - roleRank(b.data.role) || a.data.name.localeCompare(b.data.name)),
  })).filter((g) => g.members.length);
}

export const orcidOf = (s: Scholar) => s.data.identifiers?.find((i) => i.label === "ORCID");

/** Every Panorama journal with an editorial board, by its full title as the
 *  journal's own board page writes it. A scholar belongs to a journal only
 *  when an appointment card names that exact title. */
export const ALL_JOURNALS = [
  { key: "afs", title: "AI & Future Society" },
  { key: "jesa", title: "Journal of Engineering Systems and Applications" },
  { key: "health-nexus", title: "Health Nexus" },
  { key: "hndh", title: "Health Nexus: Digital Health and Medical AI" },
  { key: "csgs", title: "Climate Sustainability & Global Systems" },
  { key: "ses", title: "Journal of Sport and Exercise Studies" },
  { key: "rggd", title: "Rural Governance & Green Development" },
  { key: "cropt", title: "Contemporary Review of Political Thought" },
  { key: "irels", title: "International Review of Education and Learning Sciences" },
  { key: "jlpcs", title: "Journal of Law, Psychology, and Communication Studies" },
  { key: "jscc", title: "Journal of Social Cognition and Communication" },
  { key: "pemr", title: "PoliEcoM Administration Review" },
  { key: "grhas", title: "Global Review of Humanities, Arts, and Society" },
  { key: "jdes", title: "Journal of Dance and Embodied Structure" },
  { key: "resonance", title: "Resonance: Journal of Global Music Studies" },
  { key: "tts", title: "Three Teachings Studies" },
  { key: "silence", title: "Silence" },
] as const;

export type Journal = (typeof ALL_JOURNALS)[number];

/** Cover cloth colours of the journals featured on the home page. */
const CLOTH: Record<string, string> = {
  grhas: "#d9cfbf",
  "health-nexus": "#1f4a4a",
  silence: "#e8e6e1",
  jscc: "#0f1a33",
};
export const clothOf = (key: string) => CLOTH[key] ?? "var(--color-brand)";

/** The journals on the home page. Covers are the A4 front covers from the
 *  panorama-homepage repo (web/src/assets/journal-covers), resized to 1000px. */
export const JOURNALS = ["grhas", "health-nexus", "silence", "jscc"].map((k) => ({
  ...ALL_JOURNALS.find((j) => j.key === k)!,
  cloth: CLOTH[k],
}));

const journalKey = (title: string) => title.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
const byTitle = new Map<string, Journal>(ALL_JOURNALS.map((j) => [journalKey(j.title), j]));

/** Journals a scholar holds an appointment on: the titles of appointment
 *  cards (or their entries) that name a journal exactly. Publications,
 *  biographies and look-alike names (Health Nexus vs. its Digital Health
 *  sister journal) never count. */
export function journalsOf(s: Scholar): Journal[] {
  const roles = journalRolesOf(s);
  return ALL_JOURNALS.filter((j) => j.key in roles);
}

/** The scholar's role on each journal, keyed by journal key. When a card
 *  lists several roles on one journal, the first is used. */
export function journalRolesOf(s: Scholar): Record<string, string> {
  const roles: Record<string, string> = {};
  for (const sec of s.data.sections)
    for (const item of sec.items) {
      if (item.type !== "card") continue;
      const pairs = [[item.title, item.meta?.[0]], ...(item.entries ?? []).map((e) => [e.title, e.meta])];
      for (const [title, role] of pairs) {
        const j = byTitle.get(journalKey(title!));
        if (j && !(j.key in roles)) roles[j.key] = role || s.data.role;
      }
    }
  return roles;
}
