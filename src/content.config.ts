import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// A publication row: label is usually the year, but can be an index tag
// (SSCI, AHCI, KCI) or a format (Book).
const publication = z.object({
  type: z.literal("publication"),
  label: z.string(),
  title: z.string(),
  authors: z.string().optional(),
  venue: z.string().optional(),
  link: z.object({ href: z.url(), text: z.string() }).optional(),
});

// A free-form card used for appointments, honours, expertise, etc.
const card = z.object({
  type: z.literal("card"),
  icon: z.string().optional(),
  title: z.string(),
  meta: z.array(z.string()).optional(),
  text: z.array(z.string()).optional(),
  list: z.array(z.string()).optional(),
  entries: z.array(z.object({ title: z.string(), meta: z.string() })).optional(),
  centered: z.boolean().optional(),
});

const section = z.object({
  eyebrow: z.string().optional(),
  title: z.string().optional(),
  // list = stacked rows, grid = cards; compact = small highlight tiles
  layout: z.enum(["list", "grid"]),
  columns: z.union([z.literal(2), z.literal(3)]).optional(),
  compact: z.boolean().optional(),
  items: z.array(z.discriminatedUnion("type", [publication, card])),
});

const scholars = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/scholars" }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      nativeName: z.string().optional(),
      // Position in "Featured Scholars" on the home page (lowest first).
      order: z.number(),
      role: z.string(),
      affiliation: z.string(),
      // Shown under the name on the profile when it differs from affiliation.
      headline: z.string().optional(),
      photo: image(),
      // 4:5 window of the photo (fractions of its size), from scripts/portrait-crops.py.
      photoCrop: z.object({ x: z.number(), y: z.number(), width: z.number() }).optional(),
      summary: z.string(),
      keywords: z.array(z.string()),
      email: z.email().optional(),
      identifiers: z
        .array(z.object({ label: z.string(), value: z.string(), href: z.url() }))
        .optional(),
      sections: z.array(section).default([]),
    }),
});

export const collections = { scholars };
