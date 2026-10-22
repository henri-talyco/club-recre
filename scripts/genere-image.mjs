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

// Nano Banana 2 Lite : 0,034 $ l'image en 1024 px, soit la moitie du prix de
// gemini-3.1-flash-image, pour un rendu au moins aussi bon sur ce style la
// (compare le 28/08/2026 sur la meme scene). A un article par jour, ~11 euros
// par an. Les modeles image de Gemini n'ont pas de palier gratuit.
const MODELE = process.env.MODELE_IMAGE || "gemini-3.1-flash-lite-image";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Le modele glisse volontiers un logo ou une legende quand on ne l'interdit
// pas explicitement, et la memoire du projet garde la trace de ces derapages.
function styleKodak(aujourdhui, strict = false) {
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
    // Photos de marques: aucun signe qui permette de reconnaitre une marque ou une personne.
    ...(strict ? [
      "ABSOLUTELY NO brand name, NO logo, NO label, NO tag, NO lettering or printed words on any garment, shoe or object.",
      "Generic unbranded clothing only, never a reproduction of an identifiable real product, never a famous person or a recognisable character.",
    ] : []),
  ].join(" ");
}

/**
 * @param {object} o
 * @param {string} o.slug         nom du fichier ecrit dans public/img/<dossier>
 * @param {string} o.scene        description de scene, en anglais, sans style
 * @param {string} o.aujourdhui   AAAA-MM-JJ, sert au tampon de date
 * @param {string} o.racine       racine du depot
 * @param {string} [o.dossier]    sous-dossier de public/img (defaut "articles", "marques" pour les marques)
 * @param {string} [o.ratio]      format de l'image (defaut "4:3"; "1:1" pour les marques, recadrees en 4/3 et 4/5)
 * @param {boolean} [o.strict]    interdit marque, logo et texte sur les vetements (photos de marques)
 * @returns {Promise<{ok: boolean, chemin?: string, poids?: number, raison?: string}>}
 */
export async function genereImage({ slug, scene, aujourdhui, racine, dossier: sousDossier = "articles", ratio = "4:3", strict = false }) {
  const cle = process.env.GEMINI_API_KEY;
  if (!cle) return { ok: false, raison: "GEMINI_API_KEY absente" };
  if (!scene || scene.trim().length < 20) {
    return { ok: false, raison: "description de scene absente ou trop courte" };
  }

  const corps = {
    contents: [{ parts: [{ text: `Scene: ${scene.trim()}\n\n${styleKodak(aujourdhui, strict)}` }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: ratio },
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
  const dossier = path.join(racine, "public", "img", sousDossier);
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
    chemin: `/img/${sousDossier}/${slug}.jpg`,
    poids: Math.round(fs.statSync(chemin).size / 1024),
  };
}
