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
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { genereImage } from "./genere-image.mjs";

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

// ---------------------------------------------------------------- utilitaires

const log = (...a) => console.log(...a);
const echec = (msg) => { console.error(`ECHEC: ${msg}`); process.exit(1); };

/** Minuscules sans accents, pour comparer un keyword a un texte accentue. */
function normalise(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Les petits mots que le francais impose entre deux mots d'une requete.
const LIAISONS = "a|au|aux|de|du|des|d|le|la|les|l|un|une|pour|en|avec|sur|dans|et";

/**
 * L'expression cible est une requete Google, pas une phrase francaise:
 * "activite bebe 1 an toulouse" ne s'ecrit pas telle quelle sans faire boiter
 * la phrase. Exiger la chaine exacte revient a jeter des articles corrects, et
 * a bloquer la file puisque le sujet refuse repasse le lendemain (28/08/2026).
 *
 * On accepte donc les mots dans l'ordre, au pluriel, avec au plus deux mots de
 * liaison intercales. C'est ce que Google fait de toute facon: il ne cherche
 * pas une sous-chaine, il regarde la proximite des termes.
 */
function contientCible(texte, keyword) {
  const mots = normalise(keyword).split(/\s+/).filter(Boolean)
    .map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "s?");
  if (!mots.length) return true;
  const separateur = `[^a-z0-9]+(?:(?:${LIAISONS})[^a-z0-9]+){0,2}`;
  return new RegExp(mots.join(separateur)).test(normalise(texte));
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
    jouet: `Article sur un jouet de collection. COMMENCE PAR CHERCHER SUR LE WEB, au moins trois recherches, avant d'ecrire: les cotes bougent et ta memoire est datee. Verifie les modeles cites et leur ordre de prix (annonces recentes, sites de collectionneurs). Donne des fourchettes, jamais un prix unique, et dis d'ou vient l'ordre de grandeur. Termine par un paragraphe qui aide le lecteur a chercher par lui-meme: ou regarder, quoi verifier avant d'acheter. Un article de ce type sans recherche web est rejete automatiquement.`,
    mode: `Article mode ou marques. COMMENCE PAR CHERCHER SUR LE WEB, au moins trois recherches, avant d'ecrire: verifie l'existence, les dates et l'histoire des marques citees, ainsi que leur statut actuel (encore en activite ou disparue). Termine par un paragraphe qui aide le lecteur a chercher par lui-meme: ou regarder, quoi verifier sur une piece avant de l'acheter. Un article de ce type sans recherche web est rejete automatiquement.`,
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
L'expression "${sujet.keyword}" doit apparaitre dans le titre, dans le seoTitle, dans la seoDescription, dans le premier paragraphe, et deux a trois fois dans le corps. Naturellement, sans bourrage.

C'est une requete tapee sur Google, pas une phrase francaise. Tu peux l'accentuer, la mettre au pluriel, et glisser un petit mot de liaison entre ses mots ("a", "de", "pour", "avec"): "activite bebe 1 an toulouse" peut s'ecrire "activites bebe de 1 an a Toulouse". En revanche l'ordre des mots ne change pas, et aucun mot ne saute. Le controle automatique verifie exactement cela, dans le seoTitle et dans le texte.

LA PHOTO DE L'ARTICLE
Le champ "scenePhoto" sert a fabriquer l'illustration. Decris UNE scene de vie de famille ordinaire, en anglais, en 25 a 60 mots, en rapport direct avec le sujet: qui, quoi, ou, quelle lumiere. Des gens qui font quelque chose, jamais un objet pose sur un fond.

Ne decris ni le style, ni la pellicule, ni le cadrage, ni la date: tout cela est ajoute automatiquement apres toi. N'y mets aucun texte a afficher, aucune marque, aucun logo, aucun visage de personne reelle ou celebre. Un enfant peut apparaitre, jamais en gros plan sur le visage.

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
  "scenePhoto": "description EN ANGLAIS de la scene a photographier, 25 a 60 mots",
  "coverAlt": "texte alternatif de la photo, en francais, une phrase",
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

/**
 * Lance le CLI en fermant stdin pour de bon, et rend son stdout complet.
 * Le flux stream-json pese plusieurs Mo, on accumule sans plafond de buffer.
 */
function appelleCli(args, options) {
  return new Promise((resolve, rejeter) => {
    const enfant = spawn("claude", args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    const sortie = [];
    const erreur = [];
    enfant.stdout.on("data", (c) => sortie.push(c));
    enfant.stderr.on("data", (c) => erreur.push(c));
    enfant.on("error", rejeter);
    enfant.on("close", (code, signal) => {
      if (code === 0) return resolve(Buffer.concat(sortie).toString("utf8"));
      const e = new Error(`le CLI claude est sorti en code ${code}`);
      Object.assign(e, {
        code, signal,
        killed: signal === "SIGTERM",
        stderr: Buffer.concat(erreur).toString("utf8"),
        stdout: Buffer.concat(sortie).toString("utf8"),
      });
      rejeter(e);
    });
  });
}

async function redige(sujet, aujourdhui, refus = []) {
  // WebSearch est le seul outil ouvert: le modele cherche ses faits mais ne
  // touche pas au disque, c'est ce script qui ecrit le fichier apres validation.
  //
  // Sortie en stream-json et non en json: c'est le seul moyen de compter les
  // recherches web. Dans Claude Code, WebSearch est un outil CLIENT, il
  // n'incremente pas usage.server_tool_use.web_search_requests, qui reste a
  // zero meme quand le modele a bel et bien cherche (verifie le 24/08/2026).
  // Il faut donc compter les blocs tool_use du flux.
  // Seconde passe: le modele recoit le verdict du controle et recrit. Sans ca,
  // un seul point de forme (un mot manquant, un article trop court) suffit a
  // jeter un texte de 1500 mots deja paye.
  const correctif = refus.length
    ? `\n\nTA VERSION PRECEDENTE A ETE REFUSEE PAR LE CONTROLE AUTOMATIQUE\n${refus.map((e) => `- ${e}`).join("\n")}\n\nRecris l'article en entier en corrigeant ces points, et eux seuls si le reste tenait. Ne commente pas, ne t'excuse pas: reponds directement avec les deux blocs.`
    : "";

  const args = [
    "-p", consigneSujet(sujet, aujourdhui) + correctif,
    "--append-system-prompt", CONSIGNE_SYSTEME,
    "--model", MODELE,
    "--effort", EFFORT,
    "--tools", "WebSearch",
    "--allowedTools", "WebSearch",
    // Sans ce drapeau, un lancement en local herite de TOUS les serveurs MCP
    // configures sur la machine (verifie le 28/08/2026 : le robot voyait Praiz,
    // Slack, Talyco...). Le CI n'en a aucun, mais le script doit se comporter
    // pareil des deux cotes, et WebSearch doit rester le seul outil ouvert.
    // Ne PAS ajouter --bare pour autant : ce mode ignore le token d'abonnement.
    "--strict-mcp-config",
    "--output-format", "stream-json",
    "--verbose",
    "--no-session-persistence",
  ];

  let stdout;
  try {
    // spawn et non execFile : execFile ignore l'option stdio, donc stdin restait
    // ouvert et le CLI attendait une entree qui ne venait jamais, puis sortait en
    // code 1 (constate le 28/08/2026 en local). En CI stdin est deja vide, le bug
    // ne se voyait pas. spawn ferme vraiment stdin.
    stdout = await appelleCli(args, {
      timeout: 20 * 60 * 1000,
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
    });
  } catch (e) {
    // "Command failed: claude" tout seul n'aide personne a 2h du matin : on
    // remonte le code de sortie, le signal, et ce que le CLI a dit sur stderr.
    const details = [
      e.code !== undefined ? `code ${e.code}` : null,
      e.signal ? `signal ${e.signal}` : null,
      e.killed ? "processus tue (timeout ?)" : null,
      String(e.stderr || "").trim().slice(-500) || null,
    ].filter(Boolean).join(" | ");
    echec(`le CLI claude a echoue: ${details || e.message}`);
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
  champ("scenePhoto", 600);
  champ("coverAlt", 200);
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

  if (!contientCible(toutLeTexte, sujet.keyword)) {
    erreurs.push(`l'expression cible "${sujet.keyword}" n'apparait nulle part, meme reformulee`);
  }
  if (!contientCible(meta.seoTitle || "", sujet.keyword)) {
    erreurs.push(`l'expression cible "${sujet.keyword}" manque dans le seoTitle`);
  }

  return erreurs;
}

// -------------------------------------------------------------------- ecriture

function construitFichier(meta, corps, sujet, aujourdhui, cover) {
  const lignes = [
    "---",
    `title: ${yamlChaine(meta.title)}`,
    `description: ${yamlChaine(meta.description)}`,
    `pubDate: ${aujourdhui}`,
    `pillar: ${yamlChaine(sujet.pillar)}`,
    `tags: [${meta.tags.map(yamlChaine).join(", ")}]`,
    `author: "Club Récré"`,
    // Sans photo on n'ecrit pas le champ: le site sait afficher un degrade.
    ...(cover ? [`cover: ${yamlChaine(cover)}`, `coverAlt: ${yamlChaine(meta.coverAlt)}`] : []),
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

// Deux passes au maximum: la premiere ecrit, la seconde corrige ce que le
// controle a releve. Au dela on abandonne, le sujet repassera demain.
const TENTATIVES = 2;

let meta = null;
let blocCorps = null;
let usage = null;
let erreurs = [];

for (let essai = 1; essai <= TENTATIVES; essai++) {
  if (essai > 1) log(`\nSeconde tentative, le modele recoit le verdict du controle.`);

  const rendu = await redige(sujet, aujourdhui, essai > 1 ? erreurs : []);
  usage = rendu.usage;

  const blocMeta = extrait(rendu.texte, "meta");
  blocCorps = extrait(rendu.texte, "corps");
  if (!blocMeta || !blocCorps) {
    erreurs = ["reponse mal formee: balises <meta> ou <corps> absentes"];
  } else {
    try {
      meta = JSON.parse(blocMeta);
      erreurs = valide(meta, blocCorps, sujet, usage);
    } catch (e) {
      erreurs = [`bloc meta illisible, JSON invalide: ${e.message}`];
    }
  }

  if (!erreurs.length) break;

  console.error(`Article rejete (tentative ${essai} sur ${TENTATIVES}) :`);
  erreurs.forEach((e) => console.error(`  - ${e}`));
}

if (erreurs.length) {
  console.error(`Abandon apres ${TENTATIVES} tentatives, rien n'est ecrit.`);
  process.exit(1);
}

// Le CLI chiffre toujours en equivalent API. Sur abonnement rien n'est facture,
// la consommation est decomptee des quotas : ne pas lire ce montant comme une facture.
const cout = usage.cout ? `${usage.cout.toFixed(2)} $ en équivalent API` : "non chiffré";
log(`Valide : ${compteMots(blocCorps)} mots, ${meta.faq.length} FAQ, ${usage.recherches} recherches web`);
log(`Coût : ${cout} (${usage.output} tokens produits, ${usage.tours} tours)`);

// L'illustration ne bloque jamais la publication : un article sans photo vaut
// mieux qu'une journee sans article, et personne ne relit le robot la nuit.
let cover = null;
if (!DRY_RUN) {
  const photo = await genereImage({
    slug: sujet.slug, scene: meta.scenePhoto, aujourdhui, racine: RACINE,
  });
  if (photo.ok) {
    cover = photo.chemin;
    log(`Photo : ${photo.chemin} (${photo.poids} Ko)`);
  } else {
    log(`Pas de photo, l'article part sans : ${photo.raison}`);
  }
}

const contenu = construitFichier(meta, blocCorps, sujet, aujourdhui, cover);
const chemin = path.join(DOSSIER_ARTICLES, `${sujet.slug}.md`);

if (DRY_RUN) {
  log("\n--- DRY_RUN, rien n'est ecrit ---\n");
  log(contenu.slice(0, 1500));
  log(`\nScene prevue pour la photo : ${meta.scenePhoto}`);
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
