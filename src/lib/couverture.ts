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

const PUBLIC = path.resolve(process.cwd(), "public");

export function photoDe(article: { data: { cover?: string } }): string | undefined {
  const cover = article.data.cover;
  if (!cover) return undefined;
  if (/^https?:\/\//.test(cover)) return cover;
  return fs.existsSync(path.join(PUBLIC, cover.replace(/^\/+/, ""))) ? cover : undefined;
}
