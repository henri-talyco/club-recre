/**
 * Illustration d'article : une photo de famille de 1995, pas une image de stock.
 *
 * Le style a ete valide avec Henri : pellicule Kodak Gold 200, page d'album,
 * cadrage volontairement rate, pied ou main du parent dans le champ, date
 * orange incrustee en bas a droite. C'est le rate qui rend la photo credible,
 * une image trop propre trahit immediatement la generation.
 *
 * L'image n'est jamais bloquante : si la generation echoue, l'article part
 * quand meme, simplement sans couverture. Personne ne relit le robot la nuit,
 * mieux vaut un article sans photo qu'une journee sans article.
 */
import fs from "node:fs";
import path from "node:path";

const MODELE = process.env.MODELE_IMAGE || "gemini-3.1-flash-image";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Le modele glisse volontiers un logo ou une legende quand on ne l'interdit
// pas explicitement, et la memoire du projet garde la trace de ces derapages.
function styleKodak(aujourdhui) {
  const [, mois, jour] = aujourdhui.split("-");
  return [
    "AUTHENTIC AMATEUR KODAK GOLD 200 FILM SNAPSHOT, 1995.",
    "PHOTO ALBUM PAGE aesthetic with a white polaroid-style border.",
    "BAD AMATEUR FRAMING: slightly tilted horizon, subject off-centre.",
    "A parent's hand or slippered foot visible at the edge of the frame.",
    "Grainy film texture, slight colour cast, mild overexposure near windows.",
    "NOT instagram-worthy, NOT a product shot, NOT a studio photo.",
    "NO watermark, NO logo, NO caption, NO handwriting.",
    `No text anywhere in the image except a small orange film date stamp reading '95 ${mois} ${jour} in the bottom right corner.`,
  ].join(" ");
}

/**
 * @param {object} o
 * @param {string} o.slug         nom du fichier ecrit dans public/img/articles
 * @param {string} o.scene        description de scene, en anglais, sans style
 * @param {string} o.aujourdhui   AAAA-MM-JJ, sert au tampon de date
 * @param {string} o.racine       racine du depot
 * @returns {Promise<{ok: boolean, chemin?: string, poids?: number, raison?: string}>}
 */
export async function genereImage({ slug, scene, aujourdhui, racine }) {
  const cle = process.env.GEMINI_API_KEY;
  if (!cle) return { ok: false, raison: "GEMINI_API_KEY absente" };
  if (!scene || scene.trim().length < 20) {
    return { ok: false, raison: "description de scene absente ou trop courte" };
  }

  const corps = {
    contents: [{ parts: [{ text: `Scene: ${scene.trim()}\n\n${styleKodak(aujourdhui)}` }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "4:3" },
    },
  };

  let reponse;
  try {
    reponse = await fetch(`${BASE}/${MODELE}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": cle },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(3 * 60 * 1000),
    });
  } catch (e) {
    return { ok: false, raison: `appel Gemini impossible: ${e.message}` };
  }

  if (!reponse.ok) {
    const detail = (await reponse.text()).slice(0, 300);
    return { ok: false, raison: `Gemini a repondu ${reponse.status}: ${detail}` };
  }

  const donnees = await reponse.json();
  const parts = donnees?.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((p) => p.inlineData?.data)?.inlineData;
  if (!image) {
    // Gemini repond 200 avec un refus en texte quand le prompt le gene.
    const texte = parts.find((p) => p.text)?.text || JSON.stringify(donnees).slice(0, 300);
    return { ok: false, raison: `aucune image dans la reponse: ${texte.slice(0, 200)}` };
  }

  const brut = Buffer.from(image.data, "base64");
  const dossier = path.join(racine, "public", "img", "articles");
  fs.mkdirSync(dossier, { recursive: true });
  const chemin = path.join(dossier, `${slug}.jpg`);

  // Gemini rend du 1200 a 2000 px pour 700 a 900 Ko. Sur des pages qui visent
  // le mobile, on redescend a 1200 px de large et 82 de qualite.
  try {
    const sharp = (await import("sharp")).default;
    await sharp(brut).resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true }).toFile(chemin);
  } catch (e) {
    // sharp absent ou en echec : l'image brute vaut mieux que pas d'image.
    fs.writeFileSync(chemin, brut);
  }

  return {
    ok: true,
    chemin: `/img/articles/${slug}.jpg`,
    poids: Math.round(fs.statSync(chemin).size / 1024),
  };
}
