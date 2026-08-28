/**
 * Sert le site statique en reproduisant le comportement de Vercel sur les URLs
 * sans slash final.
 *
 * Pourquoi : une partie des pages est indexée par Google SANS slash final
 * (/journal/activites-marseille-enfant-2-ans, 66 clics par mois), une autre
 * partie AVEC. Vercel rendait les deux formes en 200. Les assets Workers
 * redirigent en 307, ce qui ajoute un saut sur des pages qui rapportent et
 * n'transfere pas proprement le signal SEO. On resout donc l'index.html
 * nous-memes, sans redirection.
 */
// Pages retirees le 28/08/2026 avec l'arret de la vente. Elles etaient
// indexees : une 301 vaut mieux qu'une 404, le signal SEO passe a la cible.
const REDIRECTIONS = {
  "/selections": "/journal",
  "/selections/": "/journal",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cible = REDIRECTIONS[url.pathname];
    if (cible) return Response.redirect(new URL(cible, url).toString(), 301);

    const dernierSegment = url.pathname.split("/").pop();
    const sansSlash = url.pathname !== "/" && !url.pathname.endsWith("/");
    const estUnFichier = dernierSegment.includes(".");

    if (sansSlash && !estUnFichier) {
      const avecSlash = new URL(url);
      avecSlash.pathname += "/";
      const reponse = await env.ASSETS.fetch(new Request(avecSlash, request));
      // Si la page existe, on la rend telle quelle a l'URL demandee.
      // Sinon on laisse le traitement normal repondre (404).
      if (reponse.status === 200) return reponse;
    }

    return env.ASSETS.fetch(request);
  },
};
