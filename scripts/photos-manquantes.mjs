#!/usr/bin/env node
/**
 * Club Recre, rattrapage des photos manquantes (version robot, sans Mac).
 *
 * Pour chaque article dont la photo manque (champ `cover` absent, ou pointant
 * vers un fichier qui n'existe pas dans public/) :
 *   1. reprend le `scenePhoto` de l'article s'il en a un, sinon en deduit un du
 *      titre (en anglais, meme consigne que le robot d'articles) et l'ecrit ;
 *   2. fabrique la photo avec scripts/genere-image.mjs (meme style Kodak 1995) ;
 *   3. ecrit `cover` et `coverAlt` dans l'en-tete de l'article.
 *
 * Meme esprit que genere-image.mjs : jamais bloquant. Sans cle ou en cas
 * d'echec, l'article reste comme il est et sera retente au passage suivant.
 * Sans --strict le code de sortie est toujours 0.
 *
 * Appele par :
 *   - .github/workflows/photos-manquantes.yml (a lancer a la main)
 *   - .github/workflows/article-quotidien.yml (apres chaque article, --max 3)
 *
 * Usage :
 *   node scripts/photos-manquantes.mjs               tous les articles sans photo
 *   node scripts/photos-manquantes.mjs --liste       montre le travail, n'ecrit rien
 *   node scripts/photos-manquantes.mjs --max 3       s'arrete apres 3 tentatives
 *   node scripts/photos-manquantes.mjs --strict      code 1 si une photo a echoue
 *   node scripts/photos-manquantes.mjs <slug>...     refait la photo de ces articles,
 *                                                    meme s'ils en ont deja une
 *
 * Variable : GEMINI_API_KEY (secret GitHub), la meme que le robot d'articles.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { genereImage } from "./genere-image.mjs";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTICLES = path.join(RACINE, "src", "content", "articles");
const MODELE_SCENE = process.env.MODELE_SCENE || "gemini-3.1-flash-lite";

const log = (...a) => console.log(...a);

// ------------------------------------------------------------------ articles

function decoupe(texte) {
  if (!texte.startsWith("---")) return { fm: "", reste: texte };
  const fin = texte.indexOf("\n---", 3);
  if (fin === -1) return { fm: "", reste: texte };
  return { fm: texte.slice(3, fin), reste: texte.slice(fin) };
}

function champ(fm, nom) {
  const m = fm.match(new RegExp(`^${nom}:[ \\t]*"?([^"\\n]+)"?`, "m"));
  return m ? m[1].trim() : null;
}

/** La scene ecrite en YAML entre guillemets doubles, relue sans perdre les guillemets internes. */
function sceneEcrite(fm) {
  const m = fm.match(/^scenePhoto:[ \t]*(.+)$/m);
  if (!m) return null;
  try { return String(JSON.parse(m[1].trim())); } catch { return m[1].trim().replace(/^["']|["']$/g, ""); }
}

const yaml = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function lisArticle(slug) {
  const chemin = path.join(ARTICLES, `${slug}.md`);
  const texte = fs.readFileSync(chemin, "utf8");
  const { fm } = decoupe(texte);
  const cover = champ(fm, "cover");
  return {
    slug, chemin, texte, cover,
    fichier: path.join(RACINE, "public", "img", "articles", `${slug}.jpg`),
    titre: champ(fm, "title") || slug,
    description: champ(fm, "description") || "",
    pubDate: (champ(fm, "pubDate") || "").slice(0, 10) || "1995-01-01",
    scene: sceneEcrite(fm),
  };
}

/** Vrai si la photo declaree par l'article existe vraiment sur le disque. */
function photoPresente(a) {
  if (!a.cover) return false;
  if (/^https?:\/\//.test(a.cover)) return true;
  return fs.existsSync(path.join(RACINE, "public", a.cover.replace(/^\/+/, "")));
}

// ------------------------------------------------------------- scene (texte)

/**
 * Meme consigne que le robot d'articles (champ scenePhoto de redige-article.mjs),
 * posee a un petit modele texte a partir du titre et du resume.
 */
async function deduitScene(a, cle) {
  const consigne = [
    "Tu prepares l'illustration d'un article de magazine pour parents.",
    `Titre : ${a.titre}`,
    a.description ? `Resume : ${a.description}` : "",
    "",
    "Decris UNE scene de vie de famille ordinaire, en anglais, en 25 a 60 mots, en rapport direct avec le sujet : qui, quoi, ou, quelle lumiere. Des gens qui font quelque chose, jamais un objet pose sur un fond.",
    "Ne decris ni le style, ni la pellicule, ni le cadrage, ni la date. N'y mets aucun texte a afficher, aucune marque, aucun logo, aucun visage de personne reelle ou celebre. Un enfant peut apparaitre, jamais en gros plan sur le visage.",
    "Reponds uniquement par la description, sans preambule ni guillemets.",
  ].filter(Boolean).join("\n");

  const rep = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELE_SCENE}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": cle },
      body: JSON.stringify({ contents: [{ parts: [{ text: consigne }] }] }),
      signal: AbortSignal.timeout(90_000),
    });
  if (!rep.ok) throw new Error(`scene refusee (${rep.status})`);
  const scene = (await rep.json())?.candidates?.[0]?.content?.parts?.[0]?.text
    ?.trim().replace(/["“”]/g, "").replace(/\s+/g, " ");
  if (!scene || scene.length < 20) throw new Error("le modele n'a rendu aucune scene exploitable");
  return scene.slice(0, 600);
}

// ------------------------------------------------------------------ ecriture

/** Pose cover, coverAlt et scenePhoto dans l'en-tete, apres `author` (sinon `pubDate`). */
function ecritEntete(a, scene) {
  const { fm, reste } = decoupe(a.texte);
  const propre = fm.split("\n")
    .filter((l) => !/^(cover|coverAlt|scenePhoto):/.test(l)).join("\n");
  const lignes = [
    `cover: ${yaml(`/img/articles/${a.slug}.jpg`)}`,
    `coverAlt: ${yaml(`Photo d'illustration, ${a.titre}`)}`,
    ...(scene ? [`scenePhoto: ${yaml(scene)}`] : []),
  ].join("\n");
  const ancre = /^author:.*$/m.test(propre) ? /^author:.*$/m : /^pubDate:.*$/m;
  if (!ancre.test(propre)) throw new Error("en-tete sans author ni pubDate");
  const fm2 = propre.replace(ancre, (l) => `${l}\n${lignes}`);
  fs.writeFileSync(a.chemin, `---${fm2}${reste}`, "utf8");
}

/** Pose uniquement la scene (photo ratee): elle sera reprise au prochain passage. */
function ecritScene(a, scene) {
  const { fm, reste } = decoupe(a.texte);
  if (/^scenePhoto:/m.test(fm)) return;
  const ancre = /^author:.*$/m.test(fm) ? /^author:.*$/m : /^pubDate:.*$/m;
  if (!ancre.test(fm)) return;
  const fm2 = fm.replace(ancre, (l) => `${l}\nscenePhoto: ${yaml(scene)}`);
  fs.writeFileSync(a.chemin, `---${fm2}${reste}`, "utf8");
}

// ----------------------------------------------------------------------- main

const args = process.argv.slice(2);
const LISTER = args.includes("--liste");
const STRICT = args.includes("--strict");
const iMax = args.indexOf("--max");
const max = iMax !== -1 ? Number(args[iMax + 1]) : Infinity;
const slugsVoulus = args.filter((x, i) => !x.startsWith("--") && !(iMax !== -1 && i === iMax + 1));

const tous = fs.readdirSync(ARTICLES).filter((f) => f.endsWith(".md")).sort()
  .map((f) => f.replace(/\.md$/, ""));

for (const s of slugsVoulus) {
  if (!tous.includes(s)) { console.error(`Article inconnu : ${s}`); process.exit(2); }
}

const cibles = (slugsVoulus.length ? slugsVoulus : tous)
  .map(lisArticle)
  .filter((a) => slugsVoulus.length || !photoPresente(a));

if (!cibles.length) {
  log("Tous les articles ont leur photo, rien a faire.");
  process.exit(0);
}

if (LISTER) {
  log(`${cibles.length} article(s) sans photo :`);
  for (const a of cibles) {
    const etat = !a.cover ? "pas de cover" : photoPresente(a) ? "refaire la photo" : `fichier introuvable (${a.cover})`;
    log(`  ${a.slug.padEnd(48)} ${etat}${a.scene ? ", scene deja ecrite" : ""}`);
  }
  process.exit(0);
}

const cle = process.env.GEMINI_API_KEY;
let faits = 0, rates = 0, restes = 0;
let tentatives = 0;

for (const [i, a] of cibles.entries()) {
  log(`[${i + 1}/${cibles.length}] ${a.slug}`);

  // Un fichier <slug>.jpg est deja la mais l'article ne le declare pas
  // (photo ecrite sans que l'en-tete suive) : il suffit de le relier.
  if (!slugsVoulus.length && fs.existsSync(a.fichier)) {
    try { ecritEntete(a, a.scene); log("    photo deja la, en-tete relie\n"); faits++; }
    catch (e) { log(`    echec : ${e.message}\n`); rates++; }
    continue;
  }

  if (tentatives >= max) { restes++; log("    reporte (limite --max atteinte)\n"); continue; }
  tentatives++;

  if (!cle) { log("    echec : GEMINI_API_KEY absente\n"); rates++; continue; }

  try {
    let scene = a.scene && a.scene !== "garder" && a.scene.length >= 20 ? a.scene : null;
    if (!scene) {
      scene = await deduitScene(a, cle);
      log(`    scene deduite : ${scene}`);
    }
    const photo = await genereImage({ slug: a.slug, scene, aujourdhui: a.pubDate, racine: RACINE });
    if (!photo.ok) {
      // On garde la scene: le prochain passage ne la redemande pas.
      if (!a.scene) ecritScene(a, scene);
      throw new Error(photo.raison);
    }
    ecritEntete(a, scene);
    log(`    ok, ${photo.poids} Ko -> public/img/articles/${a.slug}.jpg\n`);
    faits++;
  } catch (e) {
    log(`    echec : ${e.message}\n`);
    rates++;
  }
}

log(`Termine : ${faits} photo(s) posee(s), ${rates} echec(s)${restes ? `, ${restes} reportee(s)` : ""}.`);
process.exit(STRICT && rates > 0 ? 1 : 0);
