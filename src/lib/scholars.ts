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
  { key: "chief", title: "Editors-in-Chief", match: /editor-in-chief/i },
  { key: "executive", title: "Executive Editorial Board", match: /^executive editorial board/i },
  { key: "board", title: "Editorial Board", match: /editorial board member/i },
  { key: "office", title: "Editorial Office & Research", match: /./ },
] as const;

export type TierKey = (typeof TIERS)[number]["key"];

export function tierOf(s: Scholar): TierKey {
  return TIERS.find((t) => t.match.test(s.data.role))!.key;
}

/** Rank within the chief tier: Editor-in-Chief, then Co-, then Deputy. */
function roleRank(role: string): number {
  if (/^editor-in-chief/i.test(role)) return 0;
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
