// Une seule adresse par page : la forme AVEC barre finale, celle du plan du site et
// de la balise canonique. Jusqu'au 05/10/2026, la page /journal/ (la seule qui liste
// tous les articles) pointait vers la forme SANS barre : Google trouvait chaque article
// sous deux adresses qui repondaient toutes deux, et en rangeait certains sous l'une,
// certains sous l'autre (releve du jour : activites-bordeaux-enfant-2-ans indexe sans
// barre, « URL inconnue » avec). Ce plugin rattrape les liens ecrits a la main ou par
// le robot dans le corps des articles ; src/worker.js redirige le reste en 301.

export function avecBarreFinale(href) {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return href;
  const m = href.match(/^([^?#]*)(.*)$/);
  const chemin = m[1];
  if (chemin.endsWith("/") || chemin.split("/").pop().includes(".")) return href;
  return `${chemin}/${m[2]}`;
}

export function rehypeLiensInternes() {
  const visite = (noeud) => {
    if (noeud.type === "element" && noeud.tagName === "a" && noeud.properties?.href) {
      noeud.properties.href = avecBarreFinale(noeud.properties.href);
    }
    (noeud.children || []).forEach(visite);
  };
  return (arbre) => visite(arbre);
}
