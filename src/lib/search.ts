export interface SearchEntry {
  id: string;
  name: string;
  affiliation: string;
  role: string;
  url: string;
  keywords: string[];
  text: string;
}

export function loadIndex(): SearchEntry[] {
  const el = document.getElementById("search-index");
  return el ? (JSON.parse(el.textContent || "[]") as SearchEntry[]) : [];
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/**
 * Ranks entries by where the query matches: name > affiliation/keywords >
 * other text (bio and publication titles). Every word must match somewhere.
 */
export function search(index: SearchEntry[], query: string): SearchEntry[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return index;
  const scored: [SearchEntry, number][] = [];
  for (const e of index) {
    const name = norm(e.name);
    const meta = norm([e.affiliation, e.role, ...e.keywords].join(" "));
    const text = norm(e.text);
    let score = 0;
    for (const w of words) {
      if (name.includes(w)) score += 10;
      else if (meta.includes(w)) score += 4;
      else if (text.includes(w)) score += 1;
      else {
        score = 0;
        break;
      }
    }
    if (score) scored.push([e, score]);
  }
  return scored.sort((a, b) => b[1] - a[1]).map(([e]) => e);
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
