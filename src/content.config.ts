import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// The /admin editor can save a cleared optional field as "" or null (or an
// empty link object); treat those as absent rather than failing the build.
const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(blank, schema.optional());
const emptyLink = (v: unknown) =>
  v && typeof v === "object" && !blank((v as { href?: unknown }).href) ? undefined : blank(v);

// A publication row: label is usually the year, but can be an index tag
// (SSCI, AHCI, KCI) or a format (Book).
const publication = z.object({
  type: z.literal("publication"),
  label: z.string(),
  title: z.string(),
  authors: opt(z.string()),
  venue: opt(z.string()),
  link: z.preprocess(emptyLink, z.object({ href: z.url(), text: z.string() }).optional()),
});

// A free-form card used for appointments, honours, expertise, etc.
const card = z.object({
  type: z.literal("card"),
  icon: opt(z.string()),
  title: z.string(),
  meta: z.array(z.string()).optional(),
  text: z.array(z.string()).optional(),
  list: z.array(z.string()).optional(),
  entries: z.array(z.object({ title: z.string(), meta: z.string() })).optional(),
  centered: z.boolean().optional(),
});

const section = z.object({
  eyebrow: opt(z.string()),
  title: opt(z.string()),
  // list = stacked rows, grid = cards; compact = small highlight tiles
  layout: z.enum(["list", "grid"]),
  columns: opt(z.union([z.literal(2), z.literal(3)])),
  compact: z.boolean().optional(),
  items: z.array(z.discriminatedUnion("type", [publication, card])).default([]),
});

const scholars = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/scholars" }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      nativeName: opt(z.string()),
      // Position in "Featured Scholars" on the home page (lowest first).
      order: z.number(),
      role: z.string(),
      affiliation: z.string(),
      // Shown under the name on the profile when it differs from affiliation.
      headline: opt(z.string()),
      photo: image(),
      summary: z.string(),
      keywords: z.array(z.string()),
      email: opt(z.email()),
      // Extra addresses that may sign in at /edit to update this entry (the
      // public email above always can). Never shown on the site.
      loginEmails: z.preprocess((v) => (v === null ? undefined : v), z.array(z.email()).optional()),
      identifiers: z
        .array(z.object({ label: z.string(), value: z.string(), href: z.url() }))
        .optional(),
      // Sections left without items in the editor are dropped, not rendered empty.
      sections: z
        .array(section)
        .default([])
        .transform((all) => all.filter((sec) => sec.items.length > 0)),
    }),
});

export const collections = { scholars };
