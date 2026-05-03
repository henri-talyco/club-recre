# Club Récré — site web

Magazine éditorial vintage enfant 90s + e-commerce DTC en construction.

## Stack technique

- **Framework** : [Astro 5](https://astro.build/) (SSG ultra-rapide, parfait pour SEO)
- **Styling** : Tailwind CSS + Typography
- **Contenu** : Markdown via Content Collections (typage strict)
- **Déploiement cible** : Vercel ou Cloudflare Pages
- **Optimisations** : SEO maximal + GEO (Generative Engine Optimization pour ChatGPT/Claude/Perplexity)

## Lancer en local

```bash
npm install
npm run dev
# → http://localhost:4321
```

## Build de production

```bash
npm run build
# → dossier dist/ généré
npm run preview
# → preview du build
```

## Architecture du contenu

```
src/
├── content/
│   ├── articles/        # Articles éditoriaux (Markdown)
│   ├── marques/         # Pages marques détaillées (à venir)
│   └── epoques/         # Pages thématiques (à venir)
├── pages/
│   ├── index.astro      # Homepage
│   ├── journal/         # Index + articles dynamiques
│   ├── marques/         # Index + pages marques programmatic SEO
│   ├── le-club.astro    # Manifeste
│   └── newsletter.astro # Inscription
├── layouts/             # BaseLayout + ArticleLayout
├── components/          # Header, Footer, SEO, Newsletter
└── styles/global.css    # Tailwind + variables Club Récré
```

## Ajouter un nouvel article

Crée un fichier Markdown dans `src/content/articles/mon-slug.md` :

```markdown
---
title: "Titre SEO de l'article"
description: "Meta description (max 200 chars)"
pubDate: 2026-05-15
pillar: "looks" # ou "pieces-histoires" / "marques" / "epoques" / "coulisses" / "conseils-guides" / "drops"
tags: ["vintage", "années 90"]
coverAlt: "Description alt-text de la cover"
readingTime: 5
faq: # Optionnel : ajoute du Schema.org FAQPage automatiquement
  - q: "Question fréquente ?"
    a: "Réponse complète."
---

# Le contenu de l'article en Markdown

Texte normal, **gras**, *italique*.

## Titre H2

Plus de contenu.
```

L'article est automatiquement :
- Ajouté au sitemap
- Ajouté au RSS
- Avec schema.org BlogPosting + FAQPage
- Listé sur la homepage et `/journal/`

## Optimisations SEO+GEO en place

### SEO classique
- ✅ Meta titles/descriptions optimisées par page
- ✅ Open Graph + Twitter Cards
- ✅ Canonical URLs
- ✅ Sitemap auto-généré (`/sitemap-index.xml`)
- ✅ RSS feed (`/rss.xml`)
- ✅ Robots.txt avec autorisations IA explicites
- ✅ Schema.org : Organization + WebSite + BlogPosting + FAQPage
- ✅ Internal linking entre articles
- ✅ Hiérarchie H1/H2/H3 propre
- ✅ Alt-text sur images
- ✅ Core Web Vitals optimisés (Astro = HTML statique ultra-léger)

### GEO (Generative Engine Optimization 2026)
- ✅ `llms.txt` racine : présentation structurée pour LLM
- ✅ FAQ en format Q&A en bas d'articles (mangé par Perplexity, ChatGPT)
- ✅ Citations sources factuelles claires
- ✅ Tables de données structurées (équivalences tailles, prix moyens)
- ✅ Données NAP cohérentes partout
- ✅ Sections autonomes (chaque H2 peut être citée hors contexte)
- ✅ Contenu factuel vérifiable + dates de publication

## Charte graphique

Couleurs disponibles via classes Tailwind :

```html
<div class="bg-vert-recre">    <!-- #1F3D2E -->
<div class="bg-cream-gouter">  <!-- #F5E9D3 -->
<div class="bg-orange-sirop">  <!-- #E87A3C -->
<div class="bg-jaune-cassette"><!-- #F0C14B -->
<div class="bg-vert-pelouse">  <!-- #5FA68B -->
```

Polices :
- `font-bagel` : Bagel Fat One (logo + display rare)
- `font-fraunces` : Fraunces (titres)
- `font-sans` : DM Sans (corps + UI)

---

## 🚀 Déploiement (à faire UNE FOIS)

### Étape 1 — Acheter le nom de domaine (~12€/an)

**Recommandation : `clubrecre.fr` chez OVH ou Gandi.**

1. Va sur [ovh.com](https://www.ovh.com/fr/domaines/) ou [gandi.net](https://www.gandi.net/fr)
2. Cherche `clubrecre.fr`
3. Achète (~12€/an pour OVH, ~14€/an pour Gandi)
4. Optionnel : ajoute `clubrecre.com` en défensif (~10€/an)

### Étape 2 — Créer un compte GitHub (gratuit, 2 min)

1. Va sur [github.com](https://github.com)
2. Sign up
3. Crée un repo public ou privé `club-recre`
4. **Note l'URL** : `https://github.com/TONUSER/club-recre`

### Étape 3 — Créer un compte Vercel (gratuit, 2 min)

1. Va sur [vercel.com](https://vercel.com)
2. Sign up "Continue with GitHub" (lie ton compte GitHub direct)
3. C'est tout pour l'instant

### Étape 4 — Push le code sur GitHub

Depuis ce dossier (`site-prod/`), exécute :

```bash
git remote add origin https://github.com/TONUSER/club-recre.git
git branch -M main
git push -u origin main
```

(Remplace `TONUSER` par ton username GitHub)

### Étape 5 — Connecter Vercel au repo

1. Sur [vercel.com/new](https://vercel.com/new)
2. Import du repo `club-recre`
3. Vercel détecte automatiquement Astro → "Deploy"
4. ~30 secondes plus tard, ton site est live à `club-recre-XYZ.vercel.app`

### Étape 6 — Connecter ton domaine à Vercel

1. Dans Vercel, dashboard de ton projet → "Domains"
2. Add Domain → `clubrecre.fr`
3. Vercel te donne 2 enregistrements DNS à ajouter (un A record + un CNAME)
4. Va sur l'interface DNS de OVH/Gandi
5. Ajoute les 2 enregistrements indiqués par Vercel
6. Attendre 5-30 min pour la propagation DNS
7. Vercel détecte automatiquement → SSL Let's Encrypt activé → site live sur `https://clubrecre.fr` 🎉

---

## 🔄 Workflow de mise à jour (après le setup initial)

À chaque modification du contenu (nouvel article, modif design, etc.) :

```bash
git add .
git commit -m "Ajout article : tailles vintage par marque"
git push
```

→ Vercel détecte automatiquement le push, build le site, et déploie en ~30 secondes.

C'est tout. Pas de FTP, pas d'upload manuel, pas d'intervention humaine.

---

## 📊 Connecter analytics + recherche (optionnel)

### Plausible (recommandé, privacy-first)
1. Crée un compte sur [plausible.io](https://plausible.io) (~9€/mois)
2. Ajoute le domaine `clubrecre.fr`
3. Copie le snippet et colle-le dans `src/components/SEO.astro`

### Google Search Console (gratuit)
1. Va sur [search.google.com/search-console](https://search.google.com/search-console)
2. Add property → `https://clubrecre.fr`
3. Vérifie via balise meta (à ajouter dans `SEO.astro`)
4. Soumets le sitemap : `https://clubrecre.fr/sitemap-index.xml`

### Beehiiv (newsletter)
1. Crée un compte [beehiiv.com](https://beehiiv.com) (gratuit jusqu'à 2500 abonnés)
2. Récupère le code embed du formulaire
3. Remplace le contenu du form dans `src/components/Newsletter.astro`

---

## 📝 Backlog d'articles à écrire

Le site est lancé avec 6 articles fondateurs. Voici la liste suggérée pour les semaines suivantes :

- "L'été 1992 : la garde-robe d'un enfant de 6 ans" (époque)
- "Salopette OshKosh 1989 : pourquoi c'est devenu un graal" (pièce)
- "Cyrillus vintage : le guide du classique français" (marque)
- "Le mercredi de Léa : look 100% Liberty" (look)
- "Comment laver et entretenir le vintage enfant" (conseil)
- "Petit Bateau vintage : reconnaître les années 80-90" (marque)
- "Les imprimés vintage qui ne se démodent pas" (conseil)
- "Naf Naf Kids : guide du coupe-vent fluo" (marque)
- "Le goûter d'anniversaire : le look parfait" (look)
- "Comment chiner du vintage en brocante : la méthode" (conseil)

Chaque article ~1500-3000 mots, format défini dans la Content Collection.

---

## 🤖 Automation possible

Le site est conçu pour permettre du **programmatic SEO** :

1. Une base Airtable avec inventaire pièces (marque, époque, taille, prix, photo)
2. Un workflow (n8n / Make / script) qui :
   - Watche Airtable
   - Pour chaque nouvelle pièce : appel Claude API → génère titre + description SEO
   - Push vers ce repo (commit + push automatique)
   - Vercel rebuild → page live en 30 secondes

Stack à mettre en place plus tard quand le volume justifie l'effort (50+ pièces/mois).
