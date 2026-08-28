#!/usr/bin/env node
/**
 * Club Recre, rattrapage des photos d'articles.
 *
 * Trouve les articles qui n'ont pas de photo (champ `cover` absent, ou pointant
 * vers un fichier disparu), en fabrique une avec le CLI Antigravity, et met le
 * frontmatter a jour.
 *
 * Pourquoi ce script existe alors que le robot quotidien fait deja des photos :
 * il passe par le CLI Antigravity, donc par l'ABONNEMENT Google d'Henri, sans
 * cle API et sans facturation. En contrepartie il ne tourne QUE sur le Mac
 * d'Henri, ou le trousseau contient la session (service "gemini", compte
 * "antigravity"). Un runner GitHub n'a ni trousseau ni navigateur, c'est pour
 * ca que le robot nocturne, lui, utilise la cle API dans genere-image.mjs.
 *
 * Usage:
 *   node scripts/rattrape-photos.mjs            tous les articles sans photo
 *   node scripts/rattrape-photos.mjs --max 3    s'arrete apres 3 photos
 *   node scripts/rattrape-photos.mjs <slug>...  seulement ces articles
 *   node scripts/rattrape-photos.mjs --liste    montre le travail sans rien ecrire
 *   node scripts/rattrape-photos.mjs --cle      passe par la cle API (quota abo a sec)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..");
const ARTICLES = path.join(RACINE, "src", "content", "articles");
const IMAGES = path.join(RACINE, "public", "img", "articles");
const AGY = path.join(os.homedir(), ".local", "bin", "agy");
// agy depose ses rendus chez lui, pas la ou on les demande : on ira les cherc.
const SORTIES_AGY = [
  path.join(os.homedir(), ".gemini", "antigravity-cli", "scratch"),
  path.join(os.homedir(), ".gemini", "antigravity-cli", "brain"),
];

const log = (...a) => console.log(...a);

// ------------------------------------------------------------------ articles

function frontmatter(texte) {
  if (!texte.startsWith("---")) return "";
  const fin = texte.indexOf("\n---", 3);
  return fin === -1 ? "" : texte.slice(3, fin);
}

function champ(fm, nom) {
  const m = fm.match(new RegExp(`^${nom}:\\s*"?([^"\\n]+)"?`, "m"));
  return m ? m[1].trim() : null;
}

function empreinte(chemin) {
  return crypto.createHash("md5").update(fs.readFileSync(chemin)).digest("hex");
}

/**
 * Un article est a rattraper si sa photo manque, pointe dans le vide, ou n'est
 * pas la sienne. Ce dernier cas est le plus frequent : le site est parti avec
 * une vingtaine d'illustrations thematiques partagees, dont une servait a elle
 * seule 17 articles. Deux articles voisins affichaient donc la meme photo dans
 * la meme grille, ce qui se voit tout de suite.
 */
function aRattraper() {
  const articles = fs.readdirSync(ARTICLES).filter((f) => f.endsWith(".md")).sort()
    .map((f) => {
      const chemin = path.join(ARTICLES, f);
      const texte = fs.readFileSync(chemin, "utf8");
      const fm = frontmatter(texte);
      const cover = champ(fm, "cover");
      const fichier = cover ? path.join(RACINE, "public", cover.replace(/^\//, "")) : null;
      return {
        slug: f.replace(/\.md$/, ""), chemin, texte, cover,
        fichier: fichier && fs.existsSync(fichier) ? fichier : null,
        titre: champ(fm, "title") || "", description: champ(fm, "description") || "",
        pubDate: champ(fm, "pubDate") || "1995-01-01",
      };
    });

  // Deux partages possibles : le meme chemin, ou deux fichiers au contenu egal.
  const parCle = new Map();
  for (const a of articles) {
    if (!a.fichier) continue;
    const cle = empreinte(a.fichier);
    parCle.set(cle, [...(parCle.get(cle) || []), a.slug]);
  }

  return articles.map((a) => {
    if (!a.cover) return { ...a, raison: "aucune photo" };
    if (!a.fichier) return { ...a, raison: "photo introuvable sur le disque" };
    const voisins = parCle.get(empreinte(a.fichier)) || [];
    if (voisins.length > 1) {
      return { ...a, raison: `photo partagee avec ${voisins.length - 1} autre(s) article(s)` };
    }
    return null;
  }).filter(Boolean);
}

/** Les infos d'un seul article, sans passer par la detection. */
function infosArticle(slug) {
  const chemin = path.join(ARTICLES, `${slug}.md`);
  if (!fs.existsSync(chemin)) { log(`  slug inconnu, ignore : ${slug}`); return null; }
  const texte = fs.readFileSync(chemin, "utf8");
  const fm = frontmatter(texte);
  return {
    slug, chemin, texte, cover: champ(fm, "cover"), fichier: null,
    titre: champ(fm, "title") || "", description: champ(fm, "description") || "",
    pubDate: champ(fm, "pubDate") || "1995-01-01",
  };
}

// -------------------------------------------------------------------- agy

function styleKodak(pubDate) {
  const [, mois, jour] = String(pubDate).split("-");
  return [
    "AUTHENTIC AMATEUR KODAK GOLD 200 FILM SNAPSHOT, 1995.",
    "PHOTO ALBUM PAGE aesthetic with a white polaroid-style border.",
    "BAD AMATEUR FRAMING: slightly tilted horizon, subject off-centre.",
    "A parent's hand or slippered foot visible at the edge of the frame.",
    "Grainy film texture, slight colour cast, mild overexposure near windows.",
    "NOT instagram-worthy, NOT a product shot, NOT a studio photo.",
    // Constate au test du 28/08 : sans cette ligne, le modele ajoute une
    // legende manuscrite sous la photo, du type "Sarah & Molly, Nov '95".
    "NO watermark, NO logo, NO caption, NO handwriting, NO album annotation.",
    `The ONLY text allowed is a small orange film date stamp reading '95 ${mois} ${jour} in the bottom right corner.`,
  ].join(" ");
}

function lanceAgy(prompt, dossier) {
  return new Promise((resolve, rejeter) => {
    const enfant = spawn(AGY, ["-p", prompt, "--dangerously-skip-permissions"], {
      cwd: dossier, stdio: ["ignore", "pipe", "pipe"],
      timeout: 8 * 60 * 1000,
    });
    const out = [], err = [];
    enfant.stdout.on("data", (c) => out.push(c));
    enfant.stderr.on("data", (c) => err.push(c));
    enfant.on("error", rejeter);
    enfant.on("close", (code) => {
      const texte = Buffer.concat(out).toString("utf8");
      if (code === 0) return resolve(texte);
      rejeter(new Error(`agy code ${code}: ${Buffer.concat(err).toString("utf8").slice(-300) || texte.slice(-300)}`));
    });
  });
}

// Empreintes deja posees dans cette execution. agy garde ses rendus dans le
// meme dossier d'un appel a l'autre : sans ce garde-fou, un appel qui ne produit
// rien fait reprendre l'image du precedent, et deux articles repartent avec la
// meme photo. C'est exactement ce qui est arrive le 28/08 a marques-annees-90
// et polly-pocket-vintage.
const dejaPosees = new Set();

/** L'image la plus recente ecrite par agy depuis `depuis`, jamais une deja vue. */
function derniereImage(depuis) {
  const candidats = [];
  for (const racine of SORTIES_AGY) {
    if (!fs.existsSync(racine)) continue;
    const pile = [racine];
    while (pile.length) {
      const d = pile.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) pile.push(p);
        else if (/\.(png|jpe?g|webp)$/i.test(e.name)) {
          const st = fs.statSync(p);
          if (st.mtimeMs >= depuis) candidats.push({ p, t: st.mtimeMs });
        }
      }
    }
  }
  candidats.sort((a, b) => b.t - a.t);
  for (const c of candidats) {
    const e = empreinte(c.p);
    if (dejaPosees.has(e)) continue;
    dejaPosees.add(e);
    return c.p;
  }
  return null;
}

// ------------------------------------------------------- moteur de secours

/**
 * L'abonnement Google plafonne vite : 5 images le 28/08 avant
 * "Individual quota reached ... Resets in 167h". Pour un lot de plusieurs
 * dizaines d'images il faut donc la cle API, comme le robot nocturne.
 * On demande d'abord la scene a un modele texte bon marche, puis l'image.
 */
async function viaCleApi(article) {
  const { genereImage } = await import("./genere-image.mjs");
  const cle = process.env.GEMINI_API_KEY;
  if (!cle) throw new Error("GEMINI_API_KEY absente");

  const consigne = [
    "Tu prepares l'illustration d'un article de magazine pour parents.",
    `Titre : ${article.titre}`,
    article.description ? `Resume : ${article.description}` : "",
    "",
    "Decris EN ANGLAIS, en 25 a 50 mots, une scene de vie de famille ordinaire",
    "en rapport direct avec ce sujet : des gens qui font quelque chose, jamais un",
    "objet pose sur un fond. Ne decris ni style, ni pellicule, ni cadrage, ni date.",
    "Reponds uniquement par la description, sans preambule.",
  ].filter(Boolean).join("\n");

  const rep = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": cle },
      body: JSON.stringify({ contents: [{ parts: [{ text: consigne }] }] }),
      signal: AbortSignal.timeout(90_000),
    });
  if (!rep.ok) throw new Error(`scene refusee (${rep.status})`);
  const scene = (await rep.json())?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!scene) throw new Error("le modele n'a rendu aucune scene");

  const photo = await genereImage({
    slug: article.slug, scene, aujourdhui: article.pubDate, racine: RACINE,
  });
  if (!photo.ok) throw new Error(photo.raison);
  return photo.poids;
}

// ------------------------------------------------------------------- ecriture

async function poseImage(source, slug) {
  fs.mkdirSync(IMAGES, { recursive: true });
  const cible = path.join(IMAGES, `${slug}.jpg`);
  try {
    const sharp = (await import("sharp")).default;
    await sharp(fs.readFileSync(source))
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true }).toFile(cible);
  } catch {
    fs.copyFileSync(source, cible);
  }
  return Math.round(fs.statSync(cible).size / 1024);
}

function ecritCover(article, alt) {
  let texte = article.texte;
  const cover = `/img/articles/${article.slug}.jpg`;
  const yaml = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  if (/^cover:/m.test(frontmatter(texte))) {
    texte = texte.replace(/^cover:.*$/m, `cover: ${yaml(cover)}`);
    if (/^coverAlt:/m.test(frontmatter(texte))) {
      texte = texte.replace(/^coverAlt:.*$/m, `coverAlt: ${yaml(alt)}`);
    } else {
      texte = texte.replace(/^cover:.*$/m, (l) => `${l}\ncoverAlt: ${yaml(alt)}`);
    }
  } else {
    // Apres author, sinon apres pubDate : deux champs toujours presents.
    const ancre = /^author:.*$/m.test(texte) ? /^author:.*$/m : /^pubDate:.*$/m;
    texte = texte.replace(ancre, (l) => `${l}\ncover: ${yaml(cover)}\ncoverAlt: ${yaml(alt)}`);
  }
  fs.writeFileSync(article.chemin, texte, "utf8");
}

// ----------------------------------------------------------------------- main

if (!fs.existsSync(AGY) && !process.argv.includes("--cle")) {
  console.error(`ECHEC: le CLI Antigravity est introuvable (${AGY}).`);
  console.error("Installe-le avec : curl -fsSL https://antigravity.google/cli/install.sh | bash");
  process.exit(1);
}

const args = process.argv.slice(2);
const FORCE = args.includes("--force"); // refait meme si la photo est deja propre
const CLE = args.includes("--cle");  // moteur payant, quand le quota abo est a sec
const LISTER = args.includes("--liste"); // n'ecrit rien, montre le travail
const iMax = args.indexOf("--max");
const max = iMax !== -1 ? Number(args[iMax + 1]) : Infinity;
const slugsVoulus = args.filter((a) => !a.startsWith("--") && a !== String(max));

let liste = aRattraper();
if (slugsVoulus.length) {
  // --force refait une photo meme si l'article n'a rien a se reprocher : sert
  // quand le rendu est hors style, ce qu'aucun controle mecanique ne voit.
  liste = FORCE
    ? slugsVoulus.map((s) => infosArticle(s)).filter(Boolean)
        .map((a) => ({ ...a, raison: "regeneration forcee" }))
    : liste.filter((a) => slugsVoulus.includes(a.slug));
}
liste = liste.slice(0, max);

if (!liste.length) {
  log("Tous les articles ont deja leur photo, rien a faire.");
  process.exit(0);
}

for (const a of aRattraper()) if (a.fichier) dejaPosees.add(empreinte(a.fichier));

if (LISTER) {
  log(`${liste.length} article(s) a illustrer :`);
  for (const a of liste) log(`  ${a.slug.padEnd(42)} ${a.raison}`);
  process.exit(0);
}

log(`${liste.length} article(s) a illustrer, via l'abonnement Google (CLI Antigravity).\n`);

let faits = 0, rates = 0;
for (const [i, article] of liste.entries()) {
  log(`[${i + 1}/${liste.length}] ${article.slug} (${article.raison})`);

  const prompt = [
    "Genere UNE image et enregistre-la sur le disque, puis donne son chemin.",
    "",
    `Elle illustre un article de magazine intitule "${article.titre}".`,
    article.description ? `Resume de l'article : ${article.description}` : "",
    "",
    "Imagine d'abord une scene de vie de famille ordinaire, en rapport direct avec ce sujet :",
    "des gens qui font quelque chose, jamais un objet pose sur un fond. Un enfant peut apparaitre,",
    "jamais en gros plan sur le visage, et aucune personne reelle ou celebre.",
    "",
    "Puis genere l'image avec ce style, imperativement :",
    styleKodak(article.pubDate),
  ].filter(Boolean).join("\n");

  const depart = Date.now();
  try {
    let poids;
    if (CLE) {
      poids = await viaCleApi(article);
    } else {
      await lanceAgy(prompt, RACINE);
      const source = derniereImage(depart - 5000);
      if (!source) throw new Error("agy n'a produit aucun fichier image");
      poids = await poseImage(source, article.slug);
    }
    ecritCover(article, `Photo d'illustration, ${article.titre}`);
    log(`    ok, ${poids} Ko -> public/img/articles/${article.slug}.jpg\n`);
    faits++;
  } catch (e) {
    log(`    echec : ${e.message}\n`);
    rates++;
  }
}

log(`Termine : ${faits} photo(s) posee(s), ${rates} echec(s).`);
