import { defineCollection, z } from "astro:content";

const articles = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string().max(100),
    description: z.string().max(200),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    pillar: z.enum([
      "looks",
      "pieces-histoires",
      "marques",
      "epoques",
      "coulisses",
      "conseils-guides",
      "drops",
    ]),
    tags: z.array(z.string()).default([]),
    cover: z.string().optional(),
    coverAlt: z.string().optional(),
    author: z.string().default("Club Récré"),
    readingTime: z.number().int().positive().optional(),
    featured: z.boolean().default(false),
    seoTitle: z.string().max(70).optional(),
    seoDescription: z.string().max(180).optional(),
    faq: z
      .array(
        z.object({
          q: z.string(),
          a: z.string(),
        }),
      )
      .optional(),
  }),
});

const marques = defineCollection({
  type: "content",
  schema: z.object({
    name: z.string(),
    pays: z.string(),
    fondee: z.number().int(),
    epoqueDoree: z.string(),
    description: z.string().max(180),
    pieceSignature: z.string(),
    cover: z.string().optional(),
    pubDate: z.coerce.date(),
  }),
});

const epoques = defineCollection({
  type: "content",
  schema: z.object({
    name: z.string(),
    description: z.string().max(180),
    cover: z.string().optional(),
    pubDate: z.coerce.date(),
  }),
});

export const collections = {
  articles,
  marques,
  epoques,
};
