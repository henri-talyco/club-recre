/**
 * Sert le site statique, avec UNE adresse par page : celle qui finit par une barre.
 *
 * Histoire : Vercel rendait chaque page aux deux adresses (avec et sans barre finale)
 * et Google en a range une partie sous l'une, une partie sous l'autre. Les assets
 * Workers, eux, redirigent en 307 (temporaire), qui ne transmet pas proprement le
 * classement. Du 25/08 au 05/10/2026 ce worker rendait donc la page aux deux adresses.
 * Depuis le 05/10/2026 il redirige en 301 (permanent) vers l'adresse avec barre, celle
 * du plan du site et de la balise canonique : Google ne lit plus chaque page deux fois.
 * Ne pas retirer ce worker : sans lui, c'est la 307 de Cloudflare qui revient.
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
      // Si la page existe : 301 vers l'adresse avec barre finale, la seule que le plan
      // du site, la balise canonique et les liens internes annoncent. Jusqu'au
      // 05/10/2026 on rendait la page aux deux adresses : Google lisait chaque article
      // deux fois et choisissait tantot l'une, tantot l'autre. Une 301 est permanente
      // et transmet le classement, contrairement a la 307 par defaut de Cloudflare.
      // Sinon on laisse le traitement normal repondre (404).
      if (reponse.status === 200) return Response.redirect(avecSlash.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
