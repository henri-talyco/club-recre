/**
 * Club Recre, liens Amazon : verification d'un produit et pose du lien.
 *
 * Pourquoi la verification existe : le 02/10/2026, en posant des liens dans
 * les anciens articles du robot, on a trouve des livres, des jeux et des
 * etablis qui n'existaient pas (« Ou est Max ? » de Wiesner, « Hugo et
 * Toupie », « Legler Petit Menuisier »...). Un modele qui ecrit de memoire
 * invente des produits plausibles. Un lien vers un produit invente est pire
 * qu'un article sans lien : il casse la confiance et fait refuser le compte
 * Partenaires a la revue d'Amazon.
 *
 * La regle est donc calculee, jamais laissee au modele : chaque numero produit
 * (ASIN) est ouvert, le titre de la page doit contenir le nom du produit cite,
 * et un produit « indisponible » ne recoit pas de lien. Amazon refuse les
 * robots en direct ; la page est lue a travers Jina Reader (r.jina.ai), gratuit,
 * qui rend une ligne « Title: » (verifie le 02/10/2026 depuis le Mac).
 *
 * Le code d'affiliation n'est pas ecrit dans l'article : src/lib/marchands.mjs
 * l'ajoute au build, sur tous les liens amazon.fr.
 */

const ASIN = /^[A-Z0-9]{10}$/;
const VIDES = new Set(["de", "du", "des", "la", "le", "les", "et", "pour", "avec", "en", "a", "the", "and", "for", "with"]);

function normalise(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function motsPorteurs(nom) {
  return normalise(nom).split(/[^a-z0-9]+/).filter((m) => m.length >= 2 && !VIDES.has(m));
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ouvre la page Amazon d'un ASIN et dit si elle correspond au produit nomme.
 * Rend { ok, titre, raison }.
 */
/**
 * Lit la page Amazon par le lecteur web de Talyco (Lambda talyco-web, Paris),
 * quand le robot en a l'adresse et la cle (secrets GitHub TALYCO_WEB_URL et
 * TALYCO_WEB_AUTH). Sinon, par Jina Reader en direct, qui marche depuis le Mac
 * mais ne rend plus rien depuis les serveurs de GitHub (4 essais du 02/10/2026).
 */
async function litPage(asin) {
  const adresse = `https://www.amazon.fr/dp/${asin}`;
  if (process.env.TALYCO_WEB_URL && process.env.TALYCO_WEB_AUTH) {
    const rep = await fetch(process.env.TALYCO_WEB_URL, {
      method: "POST",
      signal: AbortSignal.timeout(90_000),
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: process.env.TALYCO_WEB_AUTH },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "web_read", arguments: { url: adresse, max_chars: 0 } } }),
    });
    const r = JSON.parse(await rep.text());
    const page = JSON.parse(r?.result?.content?.[0]?.text || "{}");
    if (page.status === 404) return { titre: "Amazon.fr", texte: "" };
    return { titre: String(page.title || "").replace(/&quot;/g, '"').trim(), texte: String(page.content || "") };
  }
  const rep = await fetch(`https://r.jina.ai/${adresse}`, { signal: AbortSignal.timeout(45_000) });
  const texte = await rep.text();
  return { titre: (texte.match(/^Title:\s*(.*)$/m) || [])[1]?.trim() || "", texte };
}

export async function verifieAsin(asin, nom, { essais = 2 } = {}) {
  if (!ASIN.test(asin || "")) return { ok: false, raison: `numero produit invalide « ${asin} »` };
  let titre = "";
  let texte = "";
  for (let i = 1; i <= essais; i++) {
    try {
      ({ titre, texte } = await litPage(asin));
      if (titre) break;
    } catch {
      // reseau, delai : on retente une fois, puis on renonce au lien
    }
    await attendre(4000);
  }
  if (!titre) return { ok: false, raison: "page illisible (Jina ou Amazon n'a rien rendu)" };
  if (/^amazon\.fr$/i.test(titre) || /page introuvable|page not found/i.test(titre)) {
    return { ok: false, titre, raison: "le numero produit ne mene a aucun produit" };
  }
  // « Currently unavailable » apparait aussi dans les carrousels et selon le pays
  // d'ou Jina lit la page : le 02/10/2026 depuis GitHub, le Doro Leva L30 etait
  // vu indisponible alors qu'il se vendait. On ne refuse que si la page n'a
  // AUCUN bouton d'achat.
  const achat = /add to (cart|basket)|buy now|ajouter au panier|acheter maintenant/i.test(texte);
  if (/currently unavailable|actuellement indisponible/i.test(texte) && !achat) {
    return { ok: false, titre, raison: "produit indisponible sur Amazon.fr" };
  }
  const attendus = motsPorteurs(nom);
  const dans = new Set(motsPorteurs(titre));
  const trouves = attendus.filter((m) => dans.has(m));
  // Au moins 60 % des mots du nom, et au moins deux. La marque n'est pas exigee :
  // Amazon titre « instax Mini 12 » sans « Fujifilm » (02/10/2026).
  if (!attendus.length || trouves.length < Math.min(2, attendus.length) || trouves.length / attendus.length < 0.6) {
    return { ok: false, titre, raison: `le titre de la page ne correspond pas au produit « ${nom} »` };
  }
  return { ok: true, titre };
}

/**
 * Pose un lien Amazon sur la premiere occurrence de l'ancre dans un corps
 * markdown : jamais dans un titre, un tableau, ni a l'interieur d'un lien.
 * Rend le corps modifie, ou null si l'ancre n'a pas ete trouvee.
 */
export function poseLien(corps, ancre, asin) {
  const lignes = corps.split("\n");
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i];
    if (/^\s*#/.test(ligne) || /^\s*\|/.test(ligne)) continue;
    let depart = 0;
    for (;;) {
      const pos = ligne.indexOf(ancre, depart);
      if (pos < 0) break;
      const avant = ligne.slice(0, pos);
      const dansUnLien = (avant.match(/\[/g) || []).length > (avant.match(/\]/g) || []).length;
      if (!dansUnLien) {
        lignes[i] = `${avant}[${ancre}](https://www.amazon.fr/dp/${asin})${ligne.slice(pos + ancre.length)}`;
        return lignes.join("\n");
      }
      depart = pos + 1;
    }
  }
  return null;
}

/** Un prix Amazon ecrit en dur est interdit par le programme Partenaires. */
export function prixAmazonEnDur(texte) {
  return /amazon[^.\n|]{0,60}\d+(?:[,.]\d{1,2})?\s?(?:€|euros?)|\d+(?:[,.]\d{1,2})?\s?(?:€|euros?)[^.\n|]{0,40}(?:sur|chez) amazon/i.test(texte);
}
