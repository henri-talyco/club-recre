import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

export async function GET(context: APIContext) {
  const articles = await getCollection("articles");
  return rss({
    title: "Club Récré — Journal vintage enfant 90s",
    description:
      "Magazine éditorial vintage enfant 80-90s. Looks, marques, conseils. Comment habiller son enfant en vintage 90s sans tomber dans le déguisement.",
    site: context.site!,
    items: articles
      .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
      .map((article) => ({
        title: article.data.title,
        pubDate: article.data.pubDate,
        description: article.data.description,
        link: `/journal/${article.slug}/`,
        categories: article.data.tags,
        author: article.data.author,
      })),
    customData: `<language>fr-FR</language>`,
    stylesheet: "/rss-style.xsl",
  });
}
