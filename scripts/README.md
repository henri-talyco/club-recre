# Le robot d'articles

Chaque nuit à 2h17, il prend le premier sujet de `file-sujets.json`, fait écrire l'article par Claude, vérifie que le site build, publie sur `main` et met en ligne sur Cloudflare. Personne ne relit, ce sont les garde-fous plus bas qui font barrage.

Tout se passe sur GitHub. Ton Mac peut rester éteint.

L'horaire est nocturne pour ne pas consommer les quotas d'abonnement pendant la journée de travail.

La rédaction passe par ton abonnement Claude, pas par l'API facturée à l'usage. Le robot lance le CLI `claude` avec un token d'abonnement.

## Mise en route

Deux choses à faire une seule fois.

1. Copier le token d'abonnement existant dans le presse-papier, puis le coller dans le repo sous Settings, Secrets and variables, Actions, avec le nom `CLAUDE_CODE_OAUTH_TOKEN`.

   ```bash
   cat ~/.config/anthropic-oauth-token | pbcopy
   ```

   C'est le même token que celui déjà posé sur `talyco/agent-machine`, `talyco/talyco-cockpit` et `talyco/flashoffice-cockpit`. Les secrets GitHub sont par dépôt, donc il faut le poser aussi ici. Inutile d'en générer un nouveau. S'il a expiré, `claude setup-token` en refait un valable un an.

2. Dans Settings, Actions, General, cocher « Allow GitHub Actions to create and approve pull requests ». Sans ça, le robot écrit l'article mais n'arrive pas à ouvrir la PR.

Le token ne sait faire que des requêtes au modèle. Il ne donne accès ni à tes connecteurs claude.ai, ni à tes sessions.

## Le lancer à la main

Onglet Actions, workflow « Article quotidien », bouton « Run workflow ». Tu peux forcer un sujet précis en collant son slug.

En local, ton login `claude` habituel suffit, pas besoin du token.

```bash
DRY_RUN=1 npm run article
```

`DRY_RUN=1` affiche l'article sans rien écrire ni toucher à la file.

## Relire avant publication

Le robot est en publication directe. Pour repasser à une relecture, remplacer `MODE: direct` par `MODE: pr` dans `.github/workflows/article-quotidien.yml`. Il ouvrira alors une pull request chaque nuit au lieu de publier, et tu la merges quand tu veux.

## La file de sujets

`file-sujets.json`, traitée dans l'ordre. Un sujet déjà publié est sauté, un sujet dont la PR est encore ouverte aussi.

| Champ | À quoi ça sert |
|---|---|
| `slug` | Nom du fichier et de l'URL |
| `keyword` | L'expression exacte à placer dans le titre et la meta description |
| `pillar` | Doit être une valeur du schéma dans `src/content/config.ts` |
| `type` | `ville`, `jouet`, `mode`, `saison` ou `guide`. Change les consignes de rédaction |
| `source` | D'où vient le sujet. `gsc` veut dire qu'il sort de la Search Console |

Le `type` compte. Un article `ville` va chercher de vraies adresses sur le web. Un article `jouet` ou `mode` doit vérifier ses cotes et ses dates par recherche web, sinon il est rejeté.

Quand il reste moins de 10 sujets, le robot ouvre une issue pour prévenir. Pour réalimenter la file, le bon réflexe est de partir de la Search Console, en cherchant les requêtes en position 8 à 30 qui ont des impressions et pas encore d'article dédié.

## Ce qui bloque un article

Le robot refuse de publier et sort en erreur si l'un de ces points n'est pas respecté.

- Moins de 1200 mots
- Un article `ville`, `jouet` ou `mode` écrit sans aucune recherche web. Ces sujets reposent sur des adresses, des cotes et des dates. Zéro recherche veut dire que le modèle a écrit de mémoire, donc qu'il a pu inventer
- Un tiret cadratin quelque part
- L'expression cible absente du titre SEO ou du texte. Les mots doivent s'y trouver dans l'ordre, le pluriel et les petits mots de liaison intercalés sont acceptés
- Moins de 3 questions en FAQ
- Un titre trop long pour le schéma (100, 200, 70 ou 180 caractères selon le champ)
- Du HTML ou un titre H1 dans le corps
- Un build Astro qui casse

En cas de rejet, le modèle reçoit le verdict du contrôle et recrit une fois. Si la seconde version est refusée elle aussi, rien n'est écrit ni publié, et l'échec apparaît dans l'onglet Actions. Le sujet repassera le lendemain.

## La photo de l'article

Chaque article reçoit une illustration générée par Gemini, dans le style validé : pellicule Kodak Gold 200, page d'album de famille, cadrage volontairement raté, date orange incrustée. Le modèle qui écrit l'article décrit lui-même la scène à photographier, dans le champ `scenePhoto` de sa réponse.

L'image est écrite dans `public/img/articles/<slug>.jpg`, redimensionnée à 1200 px de large, et le frontmatter reçoit `cover` et `coverAlt`.

Modèle par défaut : `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite), 0,034 $ l'image, soit une dizaine d'euros par an à un article par jour. `MODELE_IMAGE` permet d'en essayer un autre.

Elle n'est jamais bloquante. Sans le secret `GEMINI_API_KEY`, ou si la génération échoue, l'article part quand même et le site affiche un dégradé à la place.

## Ce que ça coûte

Rien en facturation. La rédaction est décomptée de ton abonnement Claude, un article par jour reste marginal. Les minutes GitHub Actions sont gratuites sur un repo public.

Le log affiche quand même un montant, en équivalent API. C'est ce que l'article aurait coûté à l'usage, pas une facture.

Deux pièges à connaître.

- Ne jamais ajouter `--bare` aux arguments du CLI. Ce mode ignore le token d'abonnement et réclame une clé API facturée.
- `ANTHROPIC_API_KEY` et `ANTHROPIC_AUTH_TOKEN` passent devant le token d'abonnement dans l'ordre de priorité du CLI. Le script les vide avant de lancer `claude`, pour qu'une variable traînant dans l'environnement ne bascule pas sur de la facturation à l'usage.

Le token expire au bout d'un an. Pour le renouveler, relancer `claude setup-token` et remplacer le secret.

## Si la PR ne te convient pas

Ferme-la. Le sujet repasse le lendemain et le robot réessaie. Pour l'écarter pour de bon, retire-le aussi de `file-sujets.json`.
