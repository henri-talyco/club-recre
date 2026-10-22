/**
 * Photo d'un article, pour les cartes et les en-tetes.
 *
 * Renvoie le chemin de la photo seulement si le fichier existe vraiment dans
 * public/. Un `cover` qui pointe dans le vide (photo effacee, robot de nuit
 * parti sans photo) donne `undefined`, et la carte retombe sur son degrade
 * au lieu d'afficher une image cassee.
 *
 * Constate le 22/10/2026 : la fiche marque ignorait `cover` et affichait un
 * degrade vert avec le titre, alors que les photos existaient.
 */
import fs from "node:fs";
import path from "node:path";
import marquesPhotos from "../data/marques-photos.json";

const PUBLIC = path.resolve(process.cwd(), "public");

export function photoDe(article: { data: { cover?: string } }): string | undefined {
  const cover = article.data.cover;
  if (!cover) return undefined;
  if (/^https?:\/\//.test(cover)) return cover;
  return fs.existsSync(path.join(PUBLIC, cover.replace(/^\/+/, ""))) ? cover : undefined;
}

/**
 * Photo d'une marque (public/img/marques/<slug>.jpg), meme principe que
 * photoDe : le chemin seulement si le fichier existe, sinon `undefined` et la
 * page garde son degrade. `alt` decrit la scene (src/data/marques-photos.json).
 */
export function photoMarque(slug: string): { src: string; alt: string } | undefined {
  const src = `/img/marques/${slug}.jpg`;
  if (!fs.existsSync(path.join(PUBLIC, src.slice(1)))) return undefined;
  const alt = marquesPhotos.find((m) => m.slug === slug)?.alt ?? "Vêtements d'enfant vintage";
  return { src, alt };
}

/**
 * Logo officiel d'une marque (public/img/marques/logos/<slug>.svg ou .png),
 * pose en calque par-dessus la photo. Chemin seulement si le fichier existe,
 * sinon `undefined` et rien ne s'affiche. Les photos generees restent sans logo.
 */
export function logoMarque(slug: string): string | undefined {
  for (const ext of ["svg", "png"]) {
    const src = `/img/marques/logos/${slug}.${ext}`;
    if (fs.existsSync(path.join(PUBLIC, src.slice(1)))) return src;
  }
  return undefined;
}
