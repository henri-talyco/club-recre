/**
 * Maillage interne calcule par le gabarit (jamais dans le texte des articles).
 *
 * Demande d'Henri du 22/10/2026 : Google ne lit plus les articles recents (62 pages
 * rangees sur 142). Il decouvre une page en suivant des liens depuis des pages qu'il
 * lit souvent. Le bloc « À lire aussi » donne donc la priorite aux pages que Google n'a
 * pas lues (src/data/pages-non-lues.json, a vider quand il les aura lues), parmi les
 * articles du meme pilier ou des memes mots.
 *
 * Le calcul se fait UNE fois pour tout le site, en ordre fixe (slug), et non page par
 * page : les pages « lues le plus » se partagent les pages non lues au lieu de citer
 * toutes les memes, et le resultat ne depend pas de l'ordre de rendu d'Astro.
 */
import type { CollectionEntry } from "astro:content";
import grappes from "../data/grappes.json";
import nonLues from "../data/pages-non-lues.json";

type Article = CollectionEntry<"articles">;

export const NB_A_LIRE_AUSSI = 4;

const VILLES = ["paris", "lyon", "marseille", "bordeaux", "toulouse", "nantes", "lille", "nice", "strasbourg", "montpellier", "rennes"];
const AGE = /(?:^|-)(\d{1,2})-ans?(?=-|$)/;

export function motif(slug: string) {
  const age = slug.match(AGE)?.[1] ?? null;
  const ville = VILLES.find((v) => slug.split("-").includes(v)) ?? null;
  let squelette = slug.replace(AGE, "-AGE");
  if (ville) squelette = squelette.split("-").map((m) => (m === ville ? "VILLE" : m)).join("-");
  return { age, ville, squelette };
}

/** 0 = jamais vue par Google, 1 = vue mais pas lue, null = rien a signaler. */
function rangNonLue(slug: string): number | null {
  if (nonLues.jamais_vues.includes(slug)) return 0;
  if (nonLues.vues_pas_lues.includes(slug)) return 1;
  return null;
}

const LUES_LE_PLUS = new Set<string>(nonLues.lues_le_plus);

export interface Maillage {
  serie: Article[];
  memeVille: Article[];
  aLireAussi: Article[];
  marques: { slug: string; nom: string }[];
}

// Les fiches /marques/<slug>/ : un article qui parle de la marque la cite depuis son pied de page.
const MARQUES = [
  { slug: "oshkosh-bgosh", nom: "OshKosh B'Gosh", motif: /osh\s?kosh/i },
  { slug: "petit-bateau", nom: "Petit Bateau", motif: /petit[\s-]bateau/i },
  { slug: "catimini", nom: "Catimini", motif: /catimini/i },
];

function marquesCitees(a: Article) {
  const entete = `${a.data.title} ${a.data.tags.join(" ")}`;
  const corps = a.body ?? "";
  return MARQUES.filter((m) => m.motif.test(entete) || (corps.match(new RegExp(m.motif.source, "gi")) ?? []).length >= 2)
    .map(({ slug, nom }) => ({ slug, nom }));
}

let calcule: { cle: string; plan: Map<string, Maillage> } | null = null;

/** Le maillage de toute la collection, calcule une fois. */
export function maillageDuSite(tous: Article[]): Map<string, Maillage> {
  const cle = tous.map((a) => a.slug).join("|");
  if (calcule?.cle === cle) return calcule.plan;

  const ordre = [...tous].sort((x, y) => x.slug.localeCompare(y.slug));

  // --- mots rares : un mot-cle ou un mot d'adresse porte par plus de 10 % des articles ne dit rien du sujet.
  const frequence = new Map<string, number>();
  for (const a of tous) for (const t of a.data.tags) frequence.set(t.toLowerCase(), (frequence.get(t.toLowerCase()) ?? 0) + 1);
  const rare = (t: string) => (frequence.get(t.toLowerCase()) ?? 0) <= tous.length * 0.1;
  const motsAdresse = (slug: string) => slug.split("-").filter((m) => m.length >= 4 && !/^\d/.test(m));
  const freqMots = new Map<string, number>();
  for (const a of tous) for (const m of new Set(motsAdresse(a.slug))) freqMots.set(m, (freqMots.get(m) ?? 0) + 1);

  const grappesDe = (slug: string) => Object.entries(grappes)
    .filter(([k, v]) => !k.startsWith("_") && Array.isArray(v) && (v as string[]).includes(slug))
    .map(([, v]) => v as string[]);

  const entrants = new Map<string, number>(); // liens recus depuis une page « lue le plus »
  const plan = new Map<string, Maillage>();
  const luesLePlus = ordre.filter((a) => LUES_LE_PLUS.has(a.slug));

  // Proximite de sujet de `a` vu depuis `entry` : grappe, mots rares en commun, pilier.
  const contexte = new Map<string, { tags: Set<string>; mots: Set<string>; grappes: string[][] }>();
  const proximite = (entry: Article, a: Article) => {
    let c = contexte.get(entry.slug);
    if (!c) {
      c = {
        tags: new Set(entry.data.tags.map((t) => t.toLowerCase()).filter(rare)),
        mots: new Set(motsAdresse(entry.slug).filter((m) => (freqMots.get(m) ?? 0) <= tous.length * 0.1)),
        grappes: grappesDe(entry.slug),
      };
      contexte.set(entry.slug, c);
    }
    return (c.grappes.some((g) => g.includes(a.slug)) ? 4 : 0)
      + a.data.tags.filter((t) => c!.tags.has(t.toLowerCase())).length * 2
      + motsAdresse(a.slug).filter((m) => c!.mots.has(m)).length * 2
      + (a.data.pillar === entry.data.pillar ? 1 : 0);
  };

  const recus = (slug: string) => entrants.get(slug) ?? 0;
  const compter = (slug: string, delta: number) => entrants.set(slug, recus(slug) + delta);

  // Les pages lues le plus d'abord : ce sont elles qui comptent pour Google, elles
  // se partagent les pages non lues avant que les autres ne prennent ce qui reste.
  const ordrePlan = [...luesLePlus, ...ordre.filter((a) => !LUES_LE_PLUS.has(a.slug))];

  for (const entry of ordrePlan) {
    const ici = motif(entry.slug);
    const autres = ordre.filter((a) => a.slug !== entry.slug);

    // Meme grille : meme squelette (age et ville remplaces), donc meme sujet a un autre age ou ailleurs.
    const serie = autres
      .map((a) => ({ a, m: motif(a.slug) }))
      .filter(({ m }) => (ici.age || ici.ville) && m.squelette === ici.squelette)
      .sort((x, y) => Number(x.m.age ?? 0) - Number(y.m.age ?? 0) || String(x.m.ville).localeCompare(String(y.m.ville)))
      .map(({ a }) => a)
      .slice(0, 8);

    // Meme ville, autre sujet : utile pour un parent de la ville.
    const memeVille = ici.ville
      ? autres.filter((a) => !serie.includes(a) && motif(a.slug).ville === ici.ville).slice(0, 4)
      : [];

    const dejaLa = new Set([entry.slug, ...serie.map((a) => a.slug), ...memeVille.map((a) => a.slug)]);
    const compte = LUES_LE_PLUS.has(entry.slug);

    const candidats = autres
      .filter((a) => !dejaLa.has(a.slug))
      .map((a) => ({ a, prox: proximite(entry, a), rang: rangNonLue(a.slug) }))
      // Meme pilier au moins : un lien sans rapport ne sert ni le lecteur ni Google.
      .filter((c) => c.prox >= 1)
      // Hors liste de priorite, un voisin trop lointain (pilier seul) n'est pas cite.
      .filter((c) => c.rang !== null || c.prox >= 2);

    // Une page non lue vaut plus qu'une page lue ; parmi les pages non lues, celle qui a
    // deja ses liens passe apres celle qui n'en a pas (charge repartie entre les sources).
    const valeur = (c: (typeof candidats)[number]) =>
      c.prox + (c.rang === 0 ? 8 : c.rang === 1 ? 7 : 0) - (compte && c.rang !== null ? recus(c.a.slug) * 3 : 0);
    const choisis = candidats
      .sort((x, y) => valeur(y) - valeur(x) || +y.a.data.pubDate - +x.a.data.pubDate || x.a.slug.localeCompare(y.a.slug))
      .slice(0, NB_A_LIRE_AUSSI)
      .map((c) => c.a);

    if (compte) {
      for (const a of [...choisis, ...serie, ...memeVille]) compter(a.slug, 1);
    }

    plan.set(entry.slug, { serie, memeVille, aLireAussi: choisis, marques: marquesCitees(entry) });
  }

  // Seconde passe : une page non lue qui n'a recu AUCUN lien d'un article lu en prend un,
  // meme d'un voisin moins proche, en remplacant la place d'une page deja bien servie.
  // L'accueil et la rubrique de la page lui en donnent deja deux, celui-ci fait le troisieme.
  const dejaCitee = (source: Article, slug: string) => {
    const m = plan.get(source.slug)!;
    return [...m.serie, ...m.memeVille, ...m.aLireAussi].some((a) => a.slug === slug);
  };
  const cibles = ordre.filter((a) => rangNonLue(a.slug) !== null && !LUES_LE_PLUS.has(a.slug));
  for (const cible of cibles.filter((c) => recus(c.slug) === 0)) {
    const sources = luesLePlus
      .filter((s) => !dejaCitee(s, cible.slug))
      .sort((x, y) => proximite(y, cible) - proximite(x, cible) || x.slug.localeCompare(y.slug));
    for (const source of sources) {
      const m = plan.get(source.slug)!;
      // La place a reprendre : une page lue d'abord, sinon la non lue la mieux servie (au moins 2 liens).
      const donneur = [...m.aLireAussi]
        .map((a) => ({ a, r: rangNonLue(a.slug) === null ? 99 : recus(a.slug) }))
        .filter((x) => x.r >= 2)
        .sort((x, y) => y.r - x.r)[0];
      if (!donneur) continue;
      m.aLireAussi = m.aLireAussi.map((a) => (a === donneur.a ? cible : a));
      compter(donneur.a.slug, -1);
      compter(cible.slug, 1);
      break;
    }
  }

  calcule = { cle, plan };
  return plan;
}
