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
 * Fait aussi la photo de chaque marque (public/img/marques/<slug>.jpg) qui n'en a
 * pas encore : la scene vient de src/data/marques-photos.json (ecrite a la main,
 * aucune marque ni texte dans l'image). Rien a ecrire dans une page : les pages
 * marques affichent la photo des que le fichier existe.
 *
 * Meme esprit que genere-image.mjs : jamais bloquant. Sans cle ou en cas
 * d'echec, l'article reste comme il est et sera retente au passage suivant.
 * Sans --strict le code de sortie est toujours 0.
 *
 * Appele par :
 *   - .github/workflows/photos-manquantes.yml (a lancer a la main)
 *   - .github/workflows/article-quotidien.yml (apres chaque article, --max 3 --sans-marques)
 *
 * Usage :
 *   node scripts/photos-manquantes.mjs               tous les articles sans photo
 *   node scripts/photos-manquantes.mjs --liste       montre le travail, n'ecrit rien
 *   node scripts/photos-manquantes.mjs --max 3       s'arrete apres 3 tentatives
 *   node scripts/photos-manquantes.mjs --sans-marques  ne touche pas aux photos de marques
 *   node scripts/photos-manquantes.mjs --marques     seulement les photos de marques
 *   node scripts/photos-manquantes.mjs --strict      code 1 si une photo a echoue
 *   node scripts/photos-manquantes.mjs <slug>...     refait la photo de ces articles
 *                                                    (ou marques), meme s'ils en ont deja une
 *
 * Variable : GEMINI_API_KEY (secret GitHub), la meme que le robot d'articles.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { genereImage } from "./genere-image.mjs";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTICLES = path.join(RACINE, "src", "content", "articles");
const MARQUES = path.join(RACINE, "src", "data", "marques-photos.json");
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

// -------------------------------------------------------------------- marques

function lisMarques() {
  return JSON.parse(fs.readFileSync(MARQUES, "utf8")).map((m) => ({
    slug: m.slug,
    scene: m.scenePhoto,
    fichier: path.join(RACINE, "public", "img", "marques", `${m.slug}.jpg`),
  }));
}

/** Date du tampon argentique: fixe pour une marque donnee, repartie sur l'annee. */
function dateMarque(slug) {
  const h = [...slug].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 336, 7);
  return `1995-${String(1 + Math.floor(h / 28)).padStart(2, "0")}-${String(1 + (h % 28)).padStart(2, "0")}`;
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
const SANS_MARQUES = args.includes("--sans-marques");
const SEULEMENT_MARQUES = args.includes("--marques");
const iMax = args.indexOf("--max");
const max = iMax !== -1 ? Number(args[iMax + 1]) : Infinity;
const slugsVoulus = args.filter((x, i) => !x.startsWith("--") && !(iMax !== -1 && i === iMax + 1));

const tous = fs.readdirSync(ARTICLES).filter((f) => f.endsWith(".md")).sort()
  .map((f) => f.replace(/\.md$/, ""));

const toutesMarques = SANS_MARQUES ? [] : lisMarques();
const slugsMarques = toutesMarques.map((m) => m.slug);

for (const s of slugsVoulus) {
  if (!tous.includes(s) && !slugsMarques.includes(s)) { console.error(`Article ou marque inconnu : ${s}`); process.exit(2); }
}

// Un slug donne en argument designe l'article ou la marque du meme nom.
const voulusArticles = slugsVoulus.filter((s) => tous.includes(s));
const voulusMarques = slugsVoulus.filter((s) => slugsMarques.includes(s));

const cibles = SEULEMENT_MARQUES ? [] : (slugsVoulus.length ? voulusArticles : tous)
  .map(lisArticle)
  .filter((a) => slugsVoulus.length || !photoPresente(a));

const ciblesMarques = SANS_MARQUES ? [] : toutesMarques
  .filter((m) => slugsVoulus.length ? voulusMarques.includes(m.slug) : !fs.existsSync(m.fichier));

if (!cibles.length && !ciblesMarques.length) {
  log(SANS_MARQUES ? "Tous les articles ont leur photo, rien a faire." : "Tous les articles et toutes les marques ont leur photo, rien a faire.");
  process.exit(0);
}

if (LISTER) {
  if (!SEULEMENT_MARQUES) {
    log(`${cibles.length} article(s) sans photo :`);
    for (const a of cibles) {
      const etat = !a.cover ? "pas de cover" : photoPresente(a) ? "refaire la photo" : `fichier introuvable (${a.cover})`;
      log(`  ${a.slug.padEnd(48)} ${etat}${a.scene ? ", scene deja ecrite" : ""}`);
    }
  }
  if (!SANS_MARQUES) {
    log(`${ciblesMarques.length} marque(s) sans photo :`);
    for (const m of ciblesMarques) {
      log(`  ${m.slug.padEnd(48)} ${fs.existsSync(m.fichier) ? "refaire la photo" : "public/img/marques/" + m.slug + ".jpg a fabriquer"}`);
    }
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

// ------------------------------------------------------------ photos de marques

for (const [i, m] of ciblesMarques.entries()) {
  log(`[marque ${i + 1}/${ciblesMarques.length}] ${m.slug}`);
  if (tentatives >= max) { restes++; log("    reporte (limite --max atteinte)\n"); continue; }
  tentatives++;
  if (!cle) { log("    echec : GEMINI_API_KEY absente\n"); rates++; continue; }
  try {
    const photo = await genereImage({
      slug: m.slug, scene: m.scene, aujourdhui: dateMarque(m.slug), racine: RACINE,
      dossier: "marques", ratio: "1:1", strict: true,
    });
    if (!photo.ok) throw new Error(photo.raison);
    log(`    ok, ${photo.poids} Ko -> public/img/marques/${m.slug}.jpg\n`);
    faits++;
  } catch (e) {
    log(`    echec : ${e.message}\n`);
    rates++;
  }
}

log(`Termine : ${faits} photo(s) posee(s), ${rates} echec(s)${restes ? `, ${restes} reportee(s)` : ""}.`);
process.exit(STRICT && rates > 0 ? 1 : 0);
