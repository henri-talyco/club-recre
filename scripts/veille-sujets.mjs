#!/usr/bin/env node
/**
 * Club Recre, veille de sujets hebdomadaire.
 *
 * Chaque lundi, interroge Semrush pour trouver de vrais sujets a fort volume
 * autour des piliers du site, et complete scripts/file-sujets.json de facon a
 * ce qu'il y ait toujours au moins une semaine d'avance.
 *
 * Pourquoi ce script existe : jusqu'au 28/08/2026 la file etait ecrite a la
 * main, au jugement. Le passage au crible de Semrush ce jour-la a montre que
 * plus d'un tiers des sujets ne valait rien (36 sujets sous 50 recherches par
 * mois, dont 8 a zero). Un sujet ne se decide plus a l'intuition : il entre
 * dans la file parce qu'un volume le justifie, ou il n'entre pas.
 *
 * Variables d'environnement :
 *   SEMRUSH_API_KEY   requis
 *   VOLUME_MINIMUM    defaut 100 recherches par mois
 *   KD_MAXIMUM        defaut 35 (au dela, le site ne passe pas devant)
 *   SUJETS_VOULUS     defaut 7 ; le workflow demande 14, le rythme etant de 2 par jour
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..");
const ARTICLES = path.join(RACINE, "src", "content", "articles");
const FICHIER = path.join(ICI, "file-sujets.json");

const VOLUME_MINIMUM = Number(process.env.VOLUME_MINIMUM || 100);
const KD_MAXIMUM = Number(process.env.KD_MAXIMUM || 35);
const VOULUS = Number(process.env.SUJETS_VOULUS || 7);

const log = (...a) => console.log(...a);

/**
 * Les graines couvrent les piliers du site. On en tire deux par semaine, par
 * rotation sur le numero de semaine : interroger les douze chaque lundi
 * couterait douze fois plus d'unites pour la meme poignee de sujets retenus.
 */
const GRAINES = [
  { phrase: "activite enfant", pillar: "activites", type: "guide" },
  { phrase: "sortie enfant", pillar: "activites", type: "ville" },
  { phrase: "anniversaire enfant", pillar: "lifestyle", type: "guide" },
  { phrase: "jouet enfant", pillar: "jouets-vintage", type: "jouet" },
  { phrase: "jouet vintage", pillar: "jouets-vintage", type: "jouet" },
  { phrase: "livre enfant", pillar: "education", type: "guide" },
  { phrase: "jeu de societe enfant", pillar: "education", type: "guide" },
  { phrase: "chambre enfant", pillar: "lifestyle", type: "guide" },
  { phrase: "vetement enfant", pillar: "marques", type: "mode" },
  { phrase: "gouter enfant", pillar: "lifestyle", type: "guide" },
  { phrase: "deguisement enfant", pillar: "lifestyle", type: "saison" },
  { phrase: "cadeau enfant", pillar: "lifestyle", type: "guide" },
];

function numeroSemaine(d = new Date()) {
  const jeudi = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  jeudi.setUTCDate(jeudi.getUTCDate() + 4 - (jeudi.getUTCDay() || 7));
  const janvier = new Date(Date.UTC(jeudi.getUTCFullYear(), 0, 1));
  return Math.ceil(((jeudi - janvier) / 86400000 + 1) / 7);
}

/** Semrush rend du CSV separe par des points-virgules, entete comprise. */
async function semrush(params) {
  const url = new URL("https://api.semrush.com/");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", process.env.SEMRUSH_API_KEY);

  const rep = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  const texte = (await rep.text()).trim();
  // Semrush repond 200 meme en erreur : le corps commence alors par ERROR.
  if (texte.startsWith("ERROR")) throw new Error(`Semrush: ${texte.slice(0, 120)}`);
  if (!texte) return [];

  // Fins de ligne Windows : sans ce nettoyage la DERNIERE colonne de l'entete
  // s'appelle "Keyword Difficulty Index\r", la lecture rend undefined, la
  // difficulte est prise pour 99 et tous les candidats sont rejetes en silence.
  const [entete, ...lignes] = texte.replace(/\r/g, "").split("\n");
  const cles = entete.split(";");
  return lignes.filter(Boolean)
    .map((l) => Object.fromEntries(l.split(";").map((v, i) => [cles[i], v.trim()])));
}

// Semrush ne distingue pas l'intention : sur "jouet enfant" il remonte d'abord
// "king jouet" (550 000 recherches) et "magasin de jouet autour de moi". Des
// requetes de marque et d'achat, sur lesquelles un magazine n'a rien a dire et
// aucune chance de passer. Verifie le 28/08/2026 : sans ce filtre, les cinq
// premiers candidats etaient tous des enseignes.
const ENSEIGNES = /\b(king ?jouet|smyths|oxybul|jouec?lub|la grande recre|picwic|toys ?r ?us|amazon|cdiscount|temu|shein|action|lidl|ikea|vertbaudet|kiabi|decathlon|leclerc|carrefour|auchan|maisons? du monde)\b/i;
const NAVIGATION = /\b(magasin|boutique|catalogue|autour de moi|pres de (chez )?moi|horaires?|soldes?|promo|code promo|pas cher|prix|livraison|avis|site officiel|en ligne|acheter|vente|destockage|occasion pro)\b/i;

/**
 * Un sujet d'article se reconnait a trois choses : il fait au moins trois mots,
 * il ne nomme pas une enseigne, et il ne cherche pas a acheter mais a savoir.
 */
function estUnSujet(phrase) {
  if (phrase.split(/\s+/).length < 3) return false;   // head term, inaccessible
  if (ENSEIGNES.test(phrase)) return false;
  if (NAVIGATION.test(phrase)) return false;
  return true;
}

function slugifie(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/** Un titre lisible a partir de la requete, le robot le reecrira de toute facon. */
function titre(phrase) {
  const t = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  return `${t} : le guide complet`;
}

// ----------------------------------------------------------------------- main

if (!process.env.SEMRUSH_API_KEY) {
  console.error("ECHEC: SEMRUSH_API_KEY absente.");
  process.exit(1);
}

const file = JSON.parse(fs.readFileSync(FICHIER, "utf8"));
const publies = new Set(fs.readdirSync(ARTICLES).filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(/\.md$/, "")));
const slugsConnus = new Set([...publies, ...file.sujets.map((s) => s.slug)]);
const motsConnus = new Set(file.sujets.map((s) => s.keyword));

log(`File actuelle : ${file.sujets.length} sujets, ${publies.size} articles publies.`);

const semaine = numeroSemaine();
// Trois graines : a deux articles par jour il faut 14 sujets, et deux graines
// n'en fournissent pas assez une fois les enseignes et les doublons ecartes.
const choisies = [0, 1, 2].map((i) => GRAINES[(semaine * 3 + i) % GRAINES.length]);
log(`Semaine ${semaine}, graines interrogees : ${choisies.map((g) => g.phrase).join(", ")}\n`);

const candidats = [];
let ecartes = 0;  // enseignes et requetes d achat, comptees pour le journal
for (const graine of choisies) {
  let lignes = [];
  try {
    lignes = await semrush({
      type: "phrase_related", phrase: graine.phrase, database: "fr",
      export_columns: "Ph,Nq,Kd", display_limit: 40, display_sort: "nq_desc",
    });
  } catch (e) {
    log(`  ${graine.phrase} : ${e.message}`);
    continue;
  }
  log(`  ${graine.phrase} : ${lignes.length} requetes remontees`);
  for (const l of lignes) {
    const phrase = (l.Keyword || "").trim();
    const volume = Number(l["Search Volume"] || 0);
    const kd = Number(l["Keyword Difficulty Index"] || 99);
    if (!phrase || motsConnus.has(phrase)) continue;
    if (!estUnSujet(phrase)) { ecartes++; continue; }
    if (volume < VOLUME_MINIMUM || kd > KD_MAXIMUM) continue;
    const slug = slugifie(phrase);
    if (slugsConnus.has(slug)) continue;
    candidats.push({ slug, titre: titre(phrase), keyword: phrase, pillar: graine.pillar,
                     type: graine.type, source: `semrush-s${semaine}`, volume, kd });
    slugsConnus.add(slug); motsConnus.add(phrase);
  }
}

// Le meilleur rapport volume sur difficulte d'abord.
candidats.sort((a, b) => (b.volume / (b.kd + 5)) - (a.volume / (a.kd + 5)));

// Sans garde-fou, une semaine entiere part sur la meme famille de requetes :
// le premier essai du 28/08 a sorti sept fois "cadeau <age>" d'affilee. On
// plafonne a deux sujets partageant leurs deux premiers mots, quitte a
// descendre plus bas dans le classement pour aller chercher autre chose.
const FAMILLE_MAXIMUM = 2;
const parFamille = new Map();
const retenus = [];
for (const c of candidats) {
  if (retenus.length >= VOULUS) break;
  const famille = c.keyword.split(/\s+/).slice(0, 2).join(" ");
  const n = parFamille.get(famille) || 0;
  if (n >= FAMILLE_MAXIMUM) continue;
  parFamille.set(famille, n + 1);
  retenus.push(c);
}

if (!retenus.length) {
  log("\nAucun sujet nouveau au-dessus des seuils. La file reste en l'etat.");
  process.exit(0);
}

log(`\n${candidats.length} candidat(s) au-dessus des seuils, ${retenus.length} retenu(s) :`);
for (const s of retenus) log(`  ${String(s.volume).padStart(6)} vol · KD ${String(s.kd).padStart(2)} · ${s.keyword}`);

file.sujets.push(...retenus);
file._maj = new Date().toISOString().slice(0, 10);
fs.writeFileSync(FICHIER, JSON.stringify(file, null, 2) + "\n", "utf8");
log(`\nFile portee a ${file.sujets.length} sujets.`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, [
    `ajoutes=${retenus.length}`,
    `total=${file.sujets.length}`,
    `resume=${retenus.map((s) => `${s.keyword} (${s.volume})`).join(", ")}`,
  ].join("\n") + "\n");
}
