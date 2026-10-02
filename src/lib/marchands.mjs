// Liens vers les boutiques : affiliation et mesure des clics.
//
// Tout lien d'article qui pointe vers une boutique listée ici est retouché au build :
//   - rel="sponsored nofollow noopener" et ouverture dans un nouvel onglet ;
//   - data-marchand, lu par le script de BaseLayout qui envoie l'événement GA4 « clic_marchand » ;
//   - l'identifiant d'affiliation, s'il est renseigné.
//
// Un identifiant vide = lien direct, sans commission, mais le clic est quand même compté.
// Pour activer une affiliation : remplir l'identifiant ici, pousser, c'est tout.
export const MARCHANDS = {
  amazon: {
    domaines: ["amazon.fr"],
    tag: "talyco-21", // compte Partenaires Amazon de Talyco, créé le 02/10/2026 (plusieurs sites)
  },
  fnac: {
    domaines: ["fnac.com"],
    awinmid: "", // identifiant de la Fnac chez Awin
    awinaffid: "", // identifiant éditeur Club Récré chez Awin
  },
  darty: { domaines: ["darty.com"], awinmid: "", awinaffid: "" },
  boulanger: { domaines: ["boulanger.com"] },
  backmarket: { domaines: ["backmarket.fr"] },
  lightphone: { domaines: ["thelightphone.com"] },
  punkt: { domaines: ["punkt.ch"] },
  mudita: { domaines: ["mudita.com"] },
  hmd: { domaines: ["hmd.com"] },
};

function marchandDe(hote) {
  for (const [cle, m] of Object.entries(MARCHANDS)) {
    if (m.domaines.some((d) => hote === d || hote.endsWith("." + d))) return cle;
  }
  return null;
}

export function lienMarchand(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const cle = marchandDe(url.hostname);
  if (!cle) return null;
  const m = MARCHANDS[cle];
  let final = url.toString();
  if (cle === "amazon" && m.tag) {
    url.searchParams.set("tag", m.tag);
    final = url.toString();
  } else if (m.awinmid && m.awinaffid) {
    final = `https://www.awin1.com/cread.php?awinmid=${m.awinmid}&awinaffid=${m.awinaffid}&ued=${encodeURIComponent(url.toString())}`;
  }
  return { cle, href: final };
}

function texte(noeud) {
  if (noeud.type === "text") return noeud.value;
  return (noeud.children || []).map(texte).join("");
}

// Plugin rehype : parcourt le HTML des articles et retouche les liens marchands.
// Le produit envoyé à GA4 est l'intertitre h3 de la section, sinon le texte du lien :
// « Doro Leva L30 » dit plus que le texte du lien, « 109,99 € sur Amazon ».
export function rehypeMarchands() {
  return (arbre) => {
    let intertitre = "";
    const parcours = (noeud) => {
      // Un h3 nomme un produit ; un h2 ouvre une partie, on retombe sur le texte du lien.
      if (noeud.type === "element" && noeud.tagName === "h2") intertitre = "";
      if (noeud.type === "element" && noeud.tagName === "h3") intertitre = texte(noeud).split(",")[0].trim();
      if (noeud.type === "element" && noeud.tagName === "a" && typeof noeud.properties?.href === "string") {
        const lien = lienMarchand(noeud.properties.href);
        if (lien) {
          noeud.properties.href = lien.href;
          noeud.properties.rel = ["sponsored", "nofollow", "noopener"];
          noeud.properties.target = "_blank";
          noeud.properties.dataMarchand = lien.cle;
          noeud.properties.dataProduit = (intertitre || texte(noeud).trim()).slice(0, 100);
        }
      }
      (noeud.children || []).forEach(parcours);
    };
    parcours(arbre);
  };
}
