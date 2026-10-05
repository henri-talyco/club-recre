// @ts-check
import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";
import mdx from "@astrojs/mdx";
import { rehypeMarchands } from "./src/lib/marchands.mjs";
import { rehypeLiensInternes } from "./src/lib/liens-internes.mjs";
import fs from "node:fs";

// slug -> date de derniere modification, lue dans le frontmatter des articles.
const DATES_ARTICLES = Object.fromEntries(
  fs.readdirSync("./src/content/articles").filter((f) => f.endsWith(".md")).map((f) => {
    const t = fs.readFileSync(`./src/content/articles/${f}`, "utf8");
    const d = (t.match(/^updatedDate:\s*"?([0-9-]+)/m) || t.match(/^pubDate:\s*"?([0-9-]+)/m) || [])[1];
    return [f.replace(/\.md$/, ""), d ? new Date(d).toISOString() : null];
  }).filter(([, d]) => d),
);

// https://astro.build/config
export default defineConfig({
  site: "https://clubrecre.fr",
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
    sitemap({
      // Date de modification REELLE de chaque article (updatedDate, sinon pubDate).
      // Jusqu'au 02/10/2026, toutes les pages portaient la date du build : Google voyait
      // 135 pages « modifiees » a chaque mise en ligne et finit par ignorer ce signal.
      // Releve du meme jour : 75 articles sur 122 jamais montres, la plupart
      // « detectee, actuellement non indexee ».
      serialize(item) {
        const m = item.url.match(/\/journal\/([^/]+)\/?$/);
        const date = m && DATES_ARTICLES[m[1]];
        if (date) item.lastmod = date;
        else delete item.lastmod;
        delete item.changefreq;
        delete item.priority;
        return item;
      },
    }),
    mdx(),
  ],
  markdown: {
    rehypePlugins: [rehypeMarchands, rehypeLiensInternes],
  },
  build: {
    inlineStylesheets: "auto",
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "viewport",
  },
});
