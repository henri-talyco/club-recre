/**
 * Club Recre, detection des sujets qui repetent un article deja publie.
 *
 * Pourquoi ce fichier existe : releve Search Console du 28/09/2026, les 68
 * articles publies depuis le 26/08 n'avaient rapporte aucun clic, et Google en
 * laissait la plupart de cote (« explore, non indexe »). Le robot ecrivait
 * plusieurs fois le meme sujet : trois Polly Pocket, « cadeau enfant 3 ans »
 * puis « idee cadeau enfant 3 ans » cinq jours plus tard. Face a deux pages
 * presque identiques, Google en garde une, presque toujours l'ancienne, et la
 * nouvelle ne sert a rien.
 *
 * La regle est calculee, jamais laissee au jugement du modele : on reduit un
 * slug ou une requete a ses mots porteurs de sens (sans les petits mots, sans
 * les mots d'emballage comme « idee » ou « guide », epoques ramenees a un seul
 * mot), puis on compare les ensembles. L'age et la ville restent des mots
 * porteurs : « activite enfant 2 ans » et « activite enfant 3 ans » sont deux
 * sujets, « cadeau enfant 3 ans » et « idee cadeau enfant 3 ans » un seul.
 */

// Les petits mots du francais et les mots qui emballent un sujet sans le changer.
const VIDES = new Set([
  "a", "au", "aux", "de", "du", "des", "d", "le", "la", "les", "l", "un", "une",
  "pour", "en", "avec", "sur", "dans", "et", "ou", "qui", "que", "quoi", "comment",
  "idee", "idees", "guide", "complet", "choisir", "bien", "meilleur", "meilleurs",
  "meilleure", "meilleures", "top", "liste", "selection", "incontournable",
  "incontournables", "culte", "cultes", "nos", "notre", "conseils", "astuces",
  // Presents dans presque tous les sujets du site, ils ne distinguent rien.
  "enfant", "enfants",
  // « prix » et « cote » : l'intention reste de savoir ce que vaut la piece.
  "prix", "cote",
]);

// Une meme epoque s'ecrit de dix facons : « 1990 », « annees 90 », « 90s »,
// « vintage », « retro ». Pour Google, c'est la meme intention.
// Les annees 80 restent un sujet a part.
const EPOQUE = new Set(["vintage", "retro", "90", "90s", "1990", "1990s", "annee", "annees",
  "enfance", "nostalgie"]);

function normalise(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Singulier grossier : « activites » et « activite » sont le meme mot. */
function singulier(mot) {
  if (/^\d/.test(mot) || mot.length <= 3) return mot;
  return mot.replace(/(x|s)$/, "");
}

/** L'ensemble des mots porteurs d'un slug ou d'une requete. */
export function signature(texte) {
  const mots = normalise(texte).split(/[^a-z0-9]+/).filter(Boolean);
  const garde = new Set();
  for (const m of mots) {
    if (VIDES.has(m)) continue;
    if (EPOQUE.has(m)) { garde.add("epoque"); continue; }
    garde.add(singulier(m));
  }
  return garde;
}

/**
 * Renvoie le premier element de `existants` (slugs ou requetes) qui repete
 * `candidat`, ou null. Deux sujets sont le meme quand ils ont exactement les
 * memes mots porteurs.
 *
 * Pourquoi l'egalite stricte et pas une proximite : un premier essai a 3 mots
 * sur 4 en commun bloquait les declinaisons par ville (« activites toulouse
 * enfant 2 ans » contre « activite enfant 2 ans »), qui sont le meilleur motif
 * du site. Une ville, un age, une occasion (Noel) font un sujet different.
 */
export function repete(candidat, existants) {
  const sc = signature(candidat);
  if (sc.size < 2) return null;
  const cle = [...sc].sort().join(" ");
  for (const e of existants) {
    const se = signature(e);
    if (se.size === sc.size && [...se].sort().join(" ") === cle) return e;
  }
  return null;
}
