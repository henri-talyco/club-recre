// Essais du choix du sujet, sans appel a Claude : `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { chargeProtegees, choisitSujet, rythmeDuJour } from "./choix-sujet.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const protegees = chargeProtegees(path.join(ICI, "pages-protegees.json"));
const enr = (slug) => ({ slug, mode: "enrichir", keyword: slug, type: "guide" });
const neuf = (slug) => ({ slug, keyword: slug, type: "guide" });
const publies = new Set(["activites-paris-enfant-1-an", "recette-enfant-2-ans", "gateau-anniversaire-enfant", "polly-pocket-1990-prix"]);
const RYTHME = { RYTHME: "enrichir-seul", JOURS_ENRICHISSEMENT: "1 5", JOURS_COMPARATIF: "3" };

test("rythme enrichir-seul : lundi et vendredi enrichissement, mercredi comparatif, le reste repos", () => {
  const mode = (j) => rythmeDuJour(RYTHME, j).mode;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(mode), ["enrichir", "repos", "comparatif", "repos", "enrichir", "repos", "repos"]);
});

test("sans RYTHME, le fonctionnement d'avant", () => {
  assert.equal(rythmeDuJour({ JOURS_COMPARATIF: "3" }, 1).mode, "normal");
  assert.equal(rythmeDuJour({ RYTHME: "normal" }, 4).mode, "normal");
});

test("un lundi : prend l'entree enrichir non protegee, refuse la protegee et la retire de la file", () => {
  const file = { sujets: [enr("activites-paris-enfant-1-an"), neuf("sujet-neuf"), enr("recette-enfant-2-ans")] };
  const r = choisitSujet(file, publies, { mode: "enrichir", protegees, aujourdhui: "2026-10-26" });
  assert.equal(r.sujet.slug, "recette-enfant-2-ans");
  assert.deepEqual(r.retires.map((x) => x.slug), ["activites-paris-enfant-1-an"]);
  assert.deepEqual(file.sujets.map((s) => s.slug), ["sujet-neuf", "recette-enfant-2-ans"]);
  assert.equal(file._retires[0].slug, "activites-paris-enfant-1-an");
  assert.match(file._retires[0].raison, /page protegee/);
});

test("un lundi sans entree enrichir utilisable : rien, et pas de sujet neuf a la place", () => {
  const file = { sujets: [enr("polly-pocket-1990-prix"), neuf("sujet-neuf")] };
  const r = choisitSujet(file, publies, { mode: "enrichir", protegees });
  assert.equal(r.sujet, null);
  assert.deepEqual(file.sujets.map((s) => s.slug), ["sujet-neuf"]);
});

test("sujet force sur une page protegee : refuse, l'entree reste", () => {
  const file = { sujets: [enr("polly-pocket-1990-prix")] };
  const r = choisitSujet(file, publies, { protegees, sujetForce: "polly-pocket-1990-prix" });
  assert.equal(r.sujet, null);
  assert.match(r.erreur, /page protegee/);
  assert.equal(file.sujets.length, 1);
});

test("sujet force non protege : accepte", () => {
  const file = { sujets: [enr("gateau-anniversaire-enfant")] };
  assert.equal(choisitSujet(file, publies, { protegees, sujetForce: "gateau-anniversaire-enfant" }).sujet.slug, "gateau-anniversaire-enfant");
});

test("fonctionnement d'avant (normal) : l'ordre de la file est respecte, la protegee est tout de meme ecartee", () => {
  const file = { sujets: [enr("activites-paris-enfant-1-an"), neuf("sujet-neuf"), enr("recette-enfant-2-ans")] };
  assert.equal(choisitSujet(file, publies, { protegees }).sujet.slug, "sujet-neuf");
});

test("les 8 pages protegees de la liste du 22/10/2026", () => {
  assert.deepEqual([...protegees.keys()].sort(), [
    "10-marques-vintage-enfant-incontournables", "activites-bordeaux-enfant-1-an", "activites-lyon-enfant-1-an",
    "activites-marseille-enfant-1-an", "activites-marseille-enfant-2-ans", "activites-paris-enfant-1-an",
    "polly-pocket-1990-prix", "telephone-sans-ecran-enfant",
  ]);
});
