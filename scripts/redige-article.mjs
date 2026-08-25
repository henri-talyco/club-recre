#!/usr/bin/env node
/**
 * Club Recre, robot d'article quotidien.
 *
 * Prend le premier sujet non publie de scripts/file-sujets.json, fait rediger
 * l'article par Claude (avec recherche web pour les faits verifiables), le
 * valide mecaniquement, ecrit le .md et retire le sujet de la file.
 *
 * Sortie:
 *   0  article ecrit
 *   3  rien a faire (file vide), ce n'est pas une erreur
 *   1  echec (aucun fichier ecrit)
 *
 * La redaction passe par le CLI Claude Code, pas par l'API payante: le token
 * CLAUDE_CODE_OAUTH_TOKEN (genere par "claude setup-token", valable un an)
 * authentifie l'abonnement Claude d'Henri. Ne jamais ajouter --bare, ce mode
 * ignore ce token et exige une cle API.
 *
 * Variables d'environnement:
 *   CLAUDE_CODE_OAUTH_TOKEN  requis (sauf en local, ou le login suffit)
 *   MODELE                   defaut opus
 *   EFFORT                   defaut high (low|medium|high|max)
 *   SUJET                    force un slug precis au lieu du premier de la file
 *   EXCLUS                   slugs a ignorer, separes par des virgules
 *   DRY_RUN                  "1" pour afficher sans ecrire ni modifier la file
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..");
const DOSSIER_ARTICLES = path.join(RACINE, "src", "content", "articles");
const FICHIER_FILE = path.join(ICI, "file-sujets.json");

// Nom complet et non l'alias "opus" : l'alias suit la version courante du CLI,
// verifie le 24/08/2026, "sonnet" resolvait encore vers claude-sonnet-4-6.
const MODELE = process.env.MODELE || "claude-opus-5";
const EFFORT = process.env.EFFORT || "high";
const DRY_RUN = process.env.DRY_RUN === "1";

const PILIERS = [
  "activites", "education", "lifestyle", "jouets-vintage", "selections",
  "looks", "pieces-histoires", "marques", "epoques", "coulisses",
  "conseils-guides", "drops",
];

const MOTS_MINIMUM = 1200;
const VINTED = "https://www.vinted.fr/member/clubrecre";

// ---------------------------------------------------------------- utilitaires

const log = (...a) => console.log(...a);
const echec = (msg) => { console.error(`ECHEC: ${msg}`); process.exit(1); };

/** Minuscules sans accents, pour comparer un keyword a un texte accentue. */
function normalise(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Une chaine YAML sure: guillemets doubles, echappement minimal. */
function yamlChaine(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function compteMots(texte) {
  return texte.split(/\s+/).filter(Boolean).length;
}

// ------------------------------------------------------------ choix du sujet

function chargeFile() {
  return JSON.parse(fs.readFileSync(FICHIER_FILE, "utf8"));
}

/**
 * Slugs a ne pas retraiter: ceux deja publies, plus ceux passes dans EXCLUS
 * (le workflow y met les articles qui attendent deja dans une pull request
 * ouverte, pour ne pas les reecrire chaque matin tant qu'ils ne sont pas merges).
 */
function slugsPublies() {
  if (!fs.existsSync(DOSSIER_ARTICLES)) echec(`dossier introuvable: ${DOSSIER_ARTICLES}`);
  const publies = fs.readdirSync(DOSSIER_ARTICLES)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
  const exclus = (process.env.EXCLUS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (exclus.length) log(`Deja en attente de relecture, ignores : ${exclus.join(", ")}`);
  return new Set([...publies, ...exclus]);
}

function choisitSujet(file, publies) {
  const restants = file.sujets.filter((s) => !publies.has(s.slug));
  if (process.env.SUJET) {
    const force = restants.find((s) => s.slug === process.env.SUJET);
    if (!force) echec(`sujet "${process.env.SUJET}" absent de la file ou deja publie`);
    return { sujet: force, restants: restants.length };
  }
  return { sujet: restants[0] || null, restants: restants.length };
}

// ------------------------------------------------------------------- consigne

const CONSIGNE_SYSTEME = `Tu ecris pour Club Recre, un magazine lifestyle francais destine aux parents citadins de 25 a 40 ans qui ont grandi dans les annees 90 et veulent transmettre cette enfance la: moins d'ecrans, plus d'autonomie, plus de qualite. Slogan du site: "On a grandi dehors, on transmet pareil."

TON
Tutoiement systematique. Phrases courtes. Direct, concret, zero remplissage. Le vocabulaire 90s est un habillage, pas le sujet: le lecteur cherche une reponse utile, la nostalgie est la voix, pas le contenu. Tu peux employer "piece", "look", "le Club", "transmettre", "comme on faisait".

REGLES ABSOLUES
1. Jamais de tiret cadratin. Ni "—" ni "–". Utilise une virgule, un point, ou des parentheses.
2. N'invente aucun fait verifiable. Un lieu, une adresse, un horaire, un tarif, une cote de jouet, un nom de marque: soit tu l'as trouve par recherche web dans ce meme echange, soit tu ne l'ecris pas. Dans le doute, reste general plutot que precis et faux.
3. Pas de balise HTML, pas de bloc de code, pas d'image. Markdown pur.
4. Pas de promesse commerciale, pas de superlatif invente ("le meilleur du marche", "teste par notre equipe") si ce n'est pas vrai.
5. Ecris en francais, avec les accents.

STRUCTURE DU CORPS
Une introduction de 2 a 3 paragraphes, puis 6 a 9 sections en H2 (##), puis une courte conclusion. Chaque H2 contient au moins deux paragraphes substantiels. Pas de H1: le titre du site le genere. Les listes a puces sont bienvenues mais ne remplacent pas les paragraphes. Longueur visee: 1400 a 1800 mots.

Une intro type: le sujet dans les annees 90 (une phrase de contexte concret), ce qui a change en 2026, ce que l'article apporte. Sans jamais recopier cette formule mot pour mot d'un article a l'autre.`;

function consigneSujet(sujet, aujourdhui) {
  const specifique = {
    ville: `Cet article est un guide de sorties reelles. COMMENCE PAR CHERCHER SUR LE WEB, au moins quatre recherches, avant d'ecrire la moindre ligne: tu ne connais pas cette ville de memoire avec assez de fiabilite pour envoyer un parent quelque part. Pour chaque lieu retenu: nom exact, quartier ou arrondissement, ce qu'on y fait, et le detail pratique qui compte pour un parent (poussette, change, duree, gratuit ou payant). Vise 8 a 10 lieux. Si tu ne trouves pas d'information fiable sur un lieu, retire-le plutot que de combler. N'invente jamais un tarif ni un horaire: si tu n'as pas la donnee, ecris que ca se verifie sur place ou sur le site du lieu. Un article de ce type sans recherche web est rejete automatiquement.`,
    jouet: `Article sur un jouet de collection. COMMENCE PAR CHERCHER SUR LE WEB, au moins trois recherches, avant d'ecrire: les cotes bougent et ta memoire est datee. Verifie les modeles cites et leur ordre de prix (annonces recentes, sites de collectionneurs). Donne des fourchettes, jamais un prix unique, et dis d'ou vient l'ordre de grandeur. Termine par un paragraphe qui renvoie vers la boutique du Club: ${VINTED}. Un article de ce type sans recherche web est rejete automatiquement.`,
    mode: `Article mode ou marques. COMMENCE PAR CHERCHER SUR LE WEB, au moins trois recherches, avant d'ecrire: verifie l'existence, les dates et l'histoire des marques citees, ainsi que leur statut actuel (encore en activite ou disparue). Termine par un paragraphe qui renvoie vers la boutique du Club: ${VINTED}. Un article de ce type sans recherche web est rejete automatiquement.`,
    saison: `Article saisonnier. Ancre-le dans la saison en cours sans le dater au point qu'il devienne faux l'annee prochaine. Evite "cette annee" et les millesimes dans le titre.`,
    guide: `Guide pratique. Sois exhaustif et reellement utile: c'est le fond qui fait le classement, l'originalite tient au ton. Utilise la recherche web pour tout element factuel (produits, references, recommandations d'age, reperes de developpement).`,
  }[sujet.type] || "";

  return `Ecris l'article du jour pour Club Recre.

SUJET
Titre indicatif: ${sujet.titre}
Expression cible: "${sujet.keyword}"
Pilier: ${sujet.pillar}
Date de publication: ${aujourdhui}

${specifique}

PLACEMENT DE L'EXPRESSION CIBLE
L'expression "${sujet.keyword}" (ou sa forme accentuee naturelle) doit apparaitre dans le titre, dans le seoTitle, dans la seoDescription, dans le premier paragraphe, et deux a trois fois dans le corps. Naturellement, sans bourrage.

FORMAT DE REPONSE
Reponds avec exactement deux blocs, rien avant, rien apres.

<meta>
{
  "title": "titre de l'article, 100 caracteres maximum",
  "description": "resume, 200 caracteres maximum",
  "tags": ["quatre", "a", "six", "tags"],
  "readingTime": 8,
  "seoTitle": "titre SEO, 70 caracteres maximum, contient l'expression cible",
  "seoDescription": "meta description, 180 caracteres maximum, contient l'expression cible",
  "faq": [
    { "q": "vraie question longue traine que les parents tapent sur Google", "a": "reponse de 80 a 150 mots, utile et precise" },
    { "q": "deuxieme question", "a": "reponse" },
    { "q": "troisieme question", "a": "reponse" }
  ]
}
</meta>
<corps>
Le corps de l'article en markdown, commencant directement par le premier paragraphe d'introduction.
</corps>

Le bloc meta doit etre du JSON strictement valide. Les guillemets internes doivent etre echappes. Le bloc corps ne contient ni frontmatter, ni titre H1, ni les balises elles-memes.`;
}

// --------------------------------------------------------------- appel modele

async function redige(sujet, aujourdhui) {
  // WebSearch est le seul outil ouvert: le modele cherche ses faits mais ne
  // touche pas au disque, c'est ce script qui ecrit le fichier apres validation.
  //
  // Sortie en stream-json et non en json: c'est le seul moyen de compter les
  // recherches web. Dans Claude Code, WebSearch est un outil CLIENT, il
  // n'incremente pas usage.server_tool_use.web_search_requests, qui reste a
  // zero meme quand le modele a bel et bien cherche (verifie le 24/08/2026).
  // Il faut donc compter les blocs tool_use du flux.
  const args = [
    "-p", consigneSujet(sujet, aujourdhui),
    "--append-system-prompt", CONSIGNE_SYSTEME,
    "--model", MODELE,
    "--effort", EFFORT,
    "--tools", "WebSearch",
    "--allowedTools", "WebSearch",
    "--output-format", "stream-json",
    "--verbose",
    "--no-session-persistence",
  ];

  let stdout;
  try {
    ({ stdout } = await execFileP("claude", args, {
      maxBuffer: 256 * 1024 * 1024,
      timeout: 20 * 60 * 1000,
      stdio: ["ignore", "pipe", "pipe"],
      // Les deux premieres passent devant le token d'abonnement dans l'ordre de
      // precedence du CLI: si l'environnement en herite, on facturerait l'API.
      // La troisieme routerait les requetes ailleurs, ou le token ne vaut rien
      // (401): c'est ce qui arrive quand on lance ce script depuis une session
      // Claude Code, qui pose son propre ANTHROPIC_BASE_URL.
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_BASE_URL: "",
      },
    }));
  } catch (e) {
    echec(`le CLI claude a echoue: ${e.shortMessage || e.message}`);
  }

  let res = null;
  let recherches = 0;
  for (const ligne of String(stdout).split("\n")) {
    if (!ligne.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(ligne);
    } catch {
      continue; // ligne de bruit, le flux reste exploitable
    }
    if (ev.type === "assistant") {
      for (const bloc of ev.message?.content ?? []) {
        if (bloc.type === "tool_use" && bloc.name === "WebSearch") recherches++;
      }
    }
    if (ev.type === "result") res = ev;
  }

  if (!res) echec(`le flux du CLI n'a pas de message final: ${String(stdout).slice(-400)}`);
  if (res.is_error || res.subtype !== "success") {
    echec(`le CLI a rendu une erreur: ${String(res.result).slice(0, 400)}`);
  }

  const u = res.usage || {};
  return {
    texte: res.result,
    usage: {
      output: u.output_tokens ?? 0,
      recherches,
      cout: res.total_cost_usd ?? 0,
      tours: res.num_turns ?? 0,
    },
  };
}

// ------------------------------------------------------------------ validation

function extrait(texte, balise) {
  const m = texte.match(new RegExp(`<${balise}>([\\s\\S]*?)</${balise}>`));
  return m ? m[1].trim() : null;
}

function valide(meta, corps, sujet, usage) {
  const erreurs = [];

  // Un article de sorties, de cotes ou de marques repose sur des faits
  // verifiables. Zero recherche web veut dire que le modele a ecrit de memoire,
  // donc qu'il a pu inventer une adresse ou un prix. On refuse, on ne relit pas.
  if (["ville", "jouet", "mode"].includes(sujet.type) && usage.recherches === 0) {
    erreurs.push(`article de type "${sujet.type}" rédigé sans aucune recherche web`);
  }
  const champ = (nom, max) => {
    const v = meta[nom];
    if (typeof v !== "string" || !v.trim()) erreurs.push(`${nom} manquant`);
    else if (v.length > max) erreurs.push(`${nom} fait ${v.length} caracteres (maximum ${max})`);
  };

  champ("title", 100);
  champ("description", 200);
  champ("seoTitle", 70);
  champ("seoDescription", 180);

  if (!Array.isArray(meta.tags) || meta.tags.length < 3) erreurs.push("moins de 3 tags");
  if (!Number.isInteger(meta.readingTime) || meta.readingTime < 1) erreurs.push("readingTime invalide");
  if (!Array.isArray(meta.faq) || meta.faq.length < 3) erreurs.push("moins de 3 FAQ");
  else meta.faq.forEach((f, i) => {
    if (!f?.q?.trim() || !f?.a?.trim()) erreurs.push(`FAQ ${i + 1} incomplete`);
  });

  if (!PILIERS.includes(sujet.pillar)) erreurs.push(`pilier inconnu: ${sujet.pillar}`);

  const mots = compteMots(corps);
  if (mots < MOTS_MINIMUM) erreurs.push(`corps trop court: ${mots} mots (minimum ${MOTS_MINIMUM})`);
  if (!/^##\s/m.test(corps)) erreurs.push("aucune section H2 dans le corps");
  if (/^#\s/m.test(corps)) erreurs.push("le corps contient un H1");
  if (corps.startsWith("---")) erreurs.push("le corps commence par un frontmatter");
  if (/<[a-z][^>]*>/i.test(corps)) erreurs.push("le corps contient du HTML");

  const toutLeTexte = [meta.title, meta.description, meta.seoTitle, meta.seoDescription, corps,
    ...(meta.faq || []).flatMap((f) => [f?.q, f?.a])].join(" ");
  if (/[—–]/.test(toutLeTexte)) erreurs.push("tiret cadratin present (interdit)");

  const cible = normalise(sujet.keyword);
  if (!normalise(toutLeTexte).includes(cible)) {
    erreurs.push(`l'expression cible "${sujet.keyword}" n'apparait nulle part`);
  }
  if (!normalise(meta.seoTitle || "").includes(cible)) {
    erreurs.push(`l'expression cible manque dans le seoTitle`);
  }

  if ((sujet.type === "jouet" || sujet.type === "mode") && !corps.includes(VINTED)) {
    erreurs.push("article jouet ou mode sans lien vers la boutique Vinted");
  }

  return erreurs;
}

// -------------------------------------------------------------------- ecriture

function construitFichier(meta, corps, sujet, aujourdhui) {
  const lignes = [
    "---",
    `title: ${yamlChaine(meta.title)}`,
    `description: ${yamlChaine(meta.description)}`,
    `pubDate: ${aujourdhui}`,
    `pillar: ${yamlChaine(sujet.pillar)}`,
    `tags: [${meta.tags.map(yamlChaine).join(", ")}]`,
    `author: "Club Récré"`,
    `readingTime: ${meta.readingTime}`,
    `seoTitle: ${yamlChaine(meta.seoTitle)}`,
    `seoDescription: ${yamlChaine(meta.seoDescription)}`,
    "faq:",
    ...meta.faq.flatMap((f) => [`  - q: ${yamlChaine(f.q)}`, `    a: ${yamlChaine(f.a)}`]),
    "---",
    "",
    corps.trim(),
    "",
  ];
  return lignes.join("\n");
}

// ------------------------------------------------------------------------ main

const aujourdhui = new Date().toISOString().slice(0, 10);
const file = chargeFile();
const publies = slugsPublies();
const { sujet, restants } = choisitSujet(file, publies);

if (!sujet) {
  log("File de sujets vide, aucun article a ecrire aujourd'hui.");
  process.exit(3);
}

log(`Sujet du jour : ${sujet.slug}`);
log(`Expression cible : "${sujet.keyword}" (type ${sujet.type}, pilier ${sujet.pillar})`);
log(`Reste dans la file apres celui-ci : ${restants - 1}`);
log(`Modele : ${MODELE}, effort ${EFFORT}`);

const { texte, usage } = await redige(sujet, aujourdhui);

const blocMeta = extrait(texte, "meta");
const blocCorps = extrait(texte, "corps");
if (!blocMeta || !blocCorps) echec("reponse mal formee: balises <meta> ou <corps> absentes");

let meta;
try {
  meta = JSON.parse(blocMeta);
} catch (e) {
  echec(`bloc meta illisible: ${e.message}`);
}

const erreurs = valide(meta, blocCorps, sujet, usage);
if (erreurs.length) {
  console.error("Article rejete :");
  erreurs.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

const contenu = construitFichier(meta, blocCorps, sujet, aujourdhui);
const chemin = path.join(DOSSIER_ARTICLES, `${sujet.slug}.md`);

// Le CLI chiffre toujours en equivalent API. Sur abonnement rien n'est facture,
// la consommation est decomptee des quotas : ne pas lire ce montant comme une facture.
const cout = usage.cout ? `${usage.cout.toFixed(2)} $ en équivalent API` : "non chiffré";
log(`Valide : ${compteMots(blocCorps)} mots, ${meta.faq.length} FAQ, ${usage.recherches} recherches web`);
log(`Coût : ${cout} (${usage.output} tokens produits, ${usage.tours} tours)`);

if (DRY_RUN) {
  log("\n--- DRY_RUN, rien n'est ecrit ---\n");
  log(contenu.slice(0, 1500));
  process.exit(0);
}

fs.writeFileSync(chemin, contenu, "utf8");
file.sujets = file.sujets.filter((s) => s.slug !== sujet.slug);
file._maj = aujourdhui;
fs.writeFileSync(FICHIER_FILE, JSON.stringify(file, null, 2) + "\n", "utf8");

log(`Ecrit : src/content/articles/${sujet.slug}.md`);

// Consomme par le workflow pour nommer le commit et la pull request.
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, [
    `slug=${sujet.slug}`,
    `titre=${meta.title.replace(/\n/g, " ")}`,
    `keyword=${sujet.keyword}`,
    `restants=${restants - 1}`,
    `mots=${compteMots(blocCorps)}`,
    `cout=${cout}`,
  ].join("\n") + "\n");
}
