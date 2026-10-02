#!/usr/bin/env node
/**
 * Club Recre, pose des liens Amazon dans des articles existants.
 *
 * Lit un fichier JSON de correspondances produit -> page Amazon, verifiees une
 * par une (titre de la page ouvert, ASIN releve), et pose chaque lien sur la
 * premiere occurrence de l'ancre dans le CORPS de l'article : jamais dans le
 * frontmatter, jamais dans un titre, jamais dans un lien existant. Le code
 * d'affiliation n'est pas ecrit ici, il est ajoute au build par
 * src/lib/marchands.mjs. Les correspondances de confiance « faible » sont
 * ignorees. L'article recoit `affiliation: true`, qui affiche la mention de
 * transparence.
 *
 * Usage : node scripts/pose-liens-amazon.mjs liens.json [--essai]
 */
import fs from "node:fs";
import path from "node:path";

const [fichier, ...options] = process.argv.slice(2);
const ESSAI = options.includes("--essai");
const RACINE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const correspondances = JSON.parse(fs.readFileSync(fichier, "utf8"));

const ASIN = /^[A-Z0-9]{10}$/;
let poses = 0, ignores = 0;

for (const [slug, { liens = [] }] of Object.entries(correspondances)) {
  const chemin = path.join(RACINE, "src/content/articles", `${slug}.md`);
  if (!fs.existsSync(chemin)) { console.log(`${slug} : article introuvable`); continue; }
  const texte = fs.readFileSync(chemin, "utf8");
  const fin = texte.indexOf("\n---", 3) + 4;
  let tete = texte.slice(0, fin);
  let corps = texte.slice(fin);
  const faits = [];

  for (const l of liens) {
    if (l.confiance === "faible" || !ASIN.test(l.asin || "") || !l.ancre) { ignores++; continue; }
    const lignes = corps.split("\n");
    let pose = false;
    for (let i = 0; i < lignes.length && !pose; i++) {
      const ligne = lignes[i];
      if (/^\s*#/.test(ligne) || /^\s*\|/.test(ligne)) continue; // ni titre, ni tableau
      let depart = 0;
      while (!pose) {
        const pos = ligne.indexOf(l.ancre, depart);
        if (pos < 0) break;
        // pas a l'interieur d'un lien markdown existant
        const avant = ligne.slice(0, pos);
        const ouvert = (avant.match(/\[/g) || []).length > (avant.match(/\]/g) || []).length;
        if (!ouvert) {
          lignes[i] = `${avant}[${l.ancre}](https://www.amazon.fr/dp/${l.asin})${ligne.slice(pos + l.ancre.length)}`;
          pose = true;
        }
        depart = pos + 1;
      }
    }
    if (pose) { corps = lignes.join("\n"); faits.push(l.produit); poses++; }
    else { console.log(`  ${slug} : ancre introuvable « ${l.ancre} »`); ignores++; }
  }

  if (faits.length) {
    if (!/^affiliation:/m.test(tete)) tete = tete.replace(/\n---\n?$/, "\naffiliation: true\n---\n");
    if (!ESSAI) fs.writeFileSync(chemin, tete + corps);
    console.log(`${slug} : ${faits.length} lien(s) ${ESSAI ? "(essai) " : ""}: ${faits.join(", ")}`);
  }
}
console.log(`\n${poses} lien(s) pose(s), ${ignores} ignore(s).`);
