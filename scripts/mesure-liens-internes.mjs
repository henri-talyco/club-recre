#!/usr/bin/env node
/**
 * Mesure, sur dist/, combien de liens chaque page « non lue par Google » recoit
 * depuis les pages que Google lit le plus (src/data/pages-non-lues.json).
 *
 * Usage : npm run build && node scripts/mesure-liens-internes.mjs
 * Sortie : un tableau Markdown, et le code de sortie 1 si une page de la liste
 * recoit moins de 3 liens (objectif du 22/10/2026).
 *
 * Une « page source » = une page lue le plus : les articles de lues_le_plus, l'accueil
 * et les rubriques. Seul le contenu de <main> est lu (ni en-tete, ni pied de page). Un lien compte une fois par page source, meme repete. Les liens
 * de la forme sans barre finale ne comptent pas : c'est la barre finale que Google
 * retient (cf src/worker.js).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(RACINE, "dist");
const donnees = JSON.parse(fs.readFileSync(path.join(RACINE, "src", "data", "pages-non-lues.json"), "utf8"));
const OBJECTIF = 3;

const RUBRIQUES = ["/activites/", "/education/", "/lifestyle/", "/jouets-vintage/", "/vintage/", "/marques/"];

function lisPage(chemin) {
  const f = path.join(DIST, chemin, "index.html");
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, "utf8");
}

/** Les adresses internes d'une page, sans doublon, sans elle-meme. */
function liensDe(html, soi) {
  const cibles = new Set();
  // Seul le contenu de <main> compte : l'en-tete et le pied de page sont les memes sur toutes
  // les pages, Google les traite comme du decor (anniversaire-enfant-5-ans est cite dans le
  // pied de page de chaque page depuis le 02/10/2026 et n'a jamais ete lu).
  const principal = html.match(/<main[\s>][\s\S]*<\/main>/);
  if (principal) html = principal[0];
  for (const m of html.matchAll(/<a\s[^>]*?href="([^"]+)"/g)) {
    let href = m[1].replace(/#.*$/, "").replace(/\?.*$/, "");
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    if (href !== soi) cibles.add(href);
  }
  return cibles;
}

const sourcesArticles = donnees.lues_le_plus.map((s) => `/journal/${s}/`);
const sources = [
  { nom: "accueil", chemin: "/", genre: "accueil/rubrique" },
  ...RUBRIQUES.map((r) => ({ nom: r, chemin: r, genre: "accueil/rubrique" })),
  ...sourcesArticles.map((c) => ({ nom: c, chemin: c, genre: "article" })),
];

const liens = new Map(); // source -> Set(cibles)
for (const s of sources) {
  const html = lisPage(s.chemin);
  if (html === null) { console.error(`Page source absente de dist/ : ${s.chemin}`); continue; }
  liens.set(s.chemin, liensDe(html, s.chemin));
}

const cibles = [
  ...donnees.jamais_vues.map((s) => ({ chemin: `/journal/${s}/`, etat: "jamais vue" })),
  ...donnees.vues_pas_lues.map((s) => ({ chemin: `/journal/${s}/`, etat: "vue, pas lue" })),
  ...(donnees.marques_jamais_vues || []).map((s) => ({ chemin: `/marques/${s}/`, etat: "jamais vue (marque)" })),
];

const lignes = [];
let sous = 0;
for (const c of cibles) {
  if (lisPage(c.chemin) === null) { console.error(`Cible absente de dist/ : ${c.chemin}`); continue; }
  const depuis = sources.filter((s) => liens.get(s.chemin)?.has(c.chemin));
  const articles = depuis.filter((s) => s.genre === "article").length;
  const accueil = depuis.length - articles;
  const total = depuis.length;
  if (total < OBJECTIF) sous++;
  lignes.push({ ...c, articles, accueil, total });
}

lignes.sort((a, b) => a.total - b.total || a.chemin.localeCompare(b.chemin));
console.log("| Page non lue | État | Liens depuis articles lus | Liens depuis accueil/rubriques | Total |");
console.log("|---|---|---:|---:|---:|");
for (const l of lignes) {
  console.log(`| ${l.chemin} | ${l.etat} | ${l.articles} | ${l.accueil} | ${l.total} |`);
}
const min = Math.min(...lignes.map((l) => l.total));
const somme = (k) => lignes.reduce((n, l) => n + l[k], 0);
console.log(`\n${lignes.length} pages mesurées, minimum ${min} lien(s), moyenne ${(somme("total") / lignes.length).toFixed(1)}.`);
console.log(`Liens depuis articles : ${somme("articles")} ; depuis accueil/rubriques : ${somme("accueil")}.`);
console.log(`Pages sous l'objectif de ${OBJECTIF} : ${sous}.`);
process.exit(sous ? 1 : 0);
