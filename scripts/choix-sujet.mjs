/**
 * Le choix du sujet du jour, separe du robot pour pouvoir l'essayer sans appeler Claude
 * (scripts/choix-sujet.test.mjs, et `CHOIX_SEUL=1 node scripts/redige-article.mjs`).
 *
 * Deux regles de la decision d'Henri du 22/10/2026, valables jusqu'au 03/12/2026 :
 *  - le RYTHME : lundi et vendredi un enrichissement et rien d'autre, mercredi le
 *    comparatif seul (cf RYTHME dans .github/workflows/article-quotidien.yml) ;
 *  - les PAGES PROTEGEES (scripts/pages-protegees.json) : le robot ne les enrichit
 *    ni ne les reecrit, et sort leur entree de la file.
 */
import fs from "node:fs";

export const RYTHME_ENRICHIR_SEUL = "enrichir-seul";

/** Le jour de la semaine a Paris, 1 = lundi ... 7 = dimanche. `JOUR_SIMULE` sert aux essais. */
export function jourParis(env = process.env, maintenant = new Date()) {
  if (env.JOUR_SIMULE) return Number(env.JOUR_SIMULE);
  const j = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "short" }).format(maintenant);
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(j) + 1;
}

const liste = (v) => String(v || "").split(/\s+/).filter(Boolean).map(Number);

/**
 * Que publie le robot aujourd'hui ?
 *   "enrichir"    un enrichissement de la file de Taly, rien d'autre
 *   "comparatif"  le comparatif seul
 *   "normal"      le fonctionnement d'avant le 22/10/2026 (file de Taly, comparatif le mercredi)
 *   "repos"       rien aujourd'hui, avec la raison
 */
export function rythmeDuJour(env = process.env, jour = jourParis(env)) {
  if (env.RYTHME !== RYTHME_ENRICHIR_SEUL) return { mode: "normal" };
  if (liste(env.JOURS_ENRICHISSEMENT).includes(jour)) return { mode: "enrichir" };
  if (liste(env.JOURS_COMPARATIF).includes(jour)) return { mode: "comparatif" };
  return { mode: "repos", raison: `rythme ${RYTHME_ENRICHIR_SEUL} : le jour ${jour} n'est ni un jour d'enrichissement (${env.JOURS_ENRICHISSEMENT || "aucun"}) ni un jour de comparatif (${env.JOURS_COMPARATIF || "aucun"})` };
}

export function chargeProtegees(fichier) {
  if (!fs.existsSync(fichier)) return new Map();
  const d = JSON.parse(fs.readFileSync(fichier, "utf8"));
  return new Map((d.pages || []).map((p) => [p.slug, p]));
}

/** Une entree est un enrichissement quand `mode` vaut "enrichir" (cf consigneEnrichir). */
export const estEnrichissement = (s) => s.mode === "enrichir";

/**
 * Premiere entree utilisable de `file`, selon `mode` ("enrichir" : enrichissements
 * seulement ; "normal" : tout). Mutations de `file` (le robot l'ecrit au retour) :
 *  - une entree « enrichir » visant une page protegee en est retiree, avec une note
 *    dans `file._retires` ; on passe a l'entree suivante ;
 *  - un sujet neuf qui repete un article publie en est retire (doublon).
 * `repete` est la fonction de scripts/doublons.mjs, passee en parametre pour les essais.
 *
 * Rend { sujet, restants, retires } ; `sujet` vaut null quand rien ne convient.
 */
export function choisitSujet(file, publies, { mode = "normal", protegees = new Map(), sujetForce = null, repete = () => null, aujourdhui = "", log = () => {} } = {}) {
  const retires = [];
  const noteRetrait = (s, raison) => {
    retires.push({ slug: s.slug, raison });
    file._retires = [...(file._retires || []), { slug: s.slug, date: aujourdhui, raison }];
  };

  // Un enrichissement porte le slug d'un article DEJA publie (c'est lui qu'on
  // reecrit) ; un nouveau sujet, jamais.
  let restants = file.sujets.filter((s) => (estEnrichissement(s) ? publies.has(s.slug) : !publies.has(s.slug)));

  if (sujetForce) {
    const force = restants.find((s) => s.slug === sujetForce);
    if (!force) return { erreur: `sujet "${sujetForce}" absent de la file ou deja publie`, sujet: null, restants: restants.length, retires };
    if (protegees.has(force.slug)) {
      return { erreur: `"${force.slug}" est une page protegee (scripts/pages-protegees.json) : le robot ne l'enrichit ni ne la reecrit. ${protegees.get(force.slug).pourquoi || ""}`.trim(), sujet: null, restants: restants.length, retires };
    }
    return { sujet: force, restants: restants.length, retires };
  }

  // Pages protegees : l'entree sort de la file, le robot passe a la suivante.
  const protegeesVisees = restants.filter((s) => estEnrichissement(s) && protegees.has(s.slug));
  for (const s of protegeesVisees) {
    const p = protegees.get(s.slug);
    const raison = `page protegee, ${p.pourquoi || "voir scripts/pages-protegees.json"} ; le robot ne l'enrichit ni ne la reecrit`;
    log(`Entree retiree de la file, ${s.slug} : ${raison}`);
    noteRetrait(s, raison);
  }
  if (protegeesVisees.length) {
    const sorties = new Set(protegeesVisees.map((s) => s.slug));
    file.sujets = file.sujets.filter((s) => !(estEnrichissement(s) && sorties.has(s.slug)));
    restants = restants.filter((s) => !(estEnrichissement(s) && sorties.has(s.slug)));
  }

  if (mode === "enrichir") restants = restants.filter(estEnrichissement);

  // Un sujet qui repete un article deja publie est retire de la file sans etre
  // ecrit : Google garderait l'ancien et ignorerait le nouveau (releve du 28/09/2026).
  const deja = [...publies];
  const doublons = new Set();
  const utiles = restants.filter((s) => {
    if (estEnrichissement(s)) return true;
    const r = repete(s.keyword, deja) || repete(s.slug, deja);
    if (r) { log(`Ecarte, repete un article publie : ${s.slug} (deja ecrit : ${r})`); doublons.add(s.slug); }
    return !r;
  });
  if (doublons.size) file.sujets = file.sujets.filter((s) => !doublons.has(s.slug));
  return { sujet: utiles[0] || null, restants: utiles.length, retires };
}
