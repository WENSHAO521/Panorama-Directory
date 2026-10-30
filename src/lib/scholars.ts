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
