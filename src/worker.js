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
  // Doublons fusionnes le 28/09/2026 : deux articles sur le meme sujet se
  // faisaient concurrence et Google n'en gardait qu'un. On garde celui qu'il
  // prefere sur 90 jours (Search Console), l'autre renvoie vers lui en 301.
  "/journal/activite-enfant-2-ans-paris": "/journal/activites-paris-enfant-2-ans/",
  "/journal/activite-enfant-2-ans-paris/": "/journal/activites-paris-enfant-2-ans/",
  "/journal/activites-paris-enfant-3-ans": "/journal/activite-enfant-3-ans-paris/",
  "/journal/activites-paris-enfant-3-ans/": "/journal/activite-enfant-3-ans-paris/",
  "/journal/chambre-enfant-vintage": "/journal/chambre-enfant-90s-vintage/",
  "/journal/chambre-enfant-vintage/": "/journal/chambre-enfant-90s-vintage/",
  "/journal/jouets-vintage-90s-incontournables": "/journal/jouets-enfance/",
  "/journal/jouets-vintage-90s-incontournables/": "/journal/jouets-enfance/",
  "/journal/jouet-annee-90": "/journal/jouets-enfance/",
  "/journal/jouet-annee-90/": "/journal/jouets-enfance/",
  "/journal/polly-pocket-vintage": "/journal/polly-pocket-1990-prix/",
  "/journal/polly-pocket-vintage/": "/journal/polly-pocket-1990-prix/",
  "/journal/polly-pocket-annees-90": "/journal/polly-pocket-1990-prix/",
  "/journal/polly-pocket-annees-90/": "/journal/polly-pocket-1990-prix/",
  "/journal/idee-cadeau-enfant-3-ans": "/journal/cadeau-enfant-3-ans/",
  "/journal/idee-cadeau-enfant-3-ans/": "/journal/cadeau-enfant-3-ans/",
  // Fusions du 02/10/2026, meme regle : la page la plus affichee sur 90 jours garde.
  "/journal/gouter-annee-90": "/journal/gouter-90s-recettes-culte/",
  "/journal/gouter-annee-90/": "/journal/gouter-90s-recettes-culte/",
  "/journal/gouter-enfant-idees": "/journal/gouter-enfant-maison/",
  "/journal/gouter-enfant-idees/": "/journal/gouter-enfant-maison/",
  "/journal/sortie-enfant-paris": "/journal/activite-enfant-paris/",
  "/journal/sortie-enfant-paris/": "/journal/activite-enfant-paris/",
  "/journal/sortie-enfant-3-ans-paris": "/journal/activite-enfant-3-ans-paris/",
  "/journal/sortie-enfant-3-ans-paris/": "/journal/activite-enfant-3-ans-paris/",
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
