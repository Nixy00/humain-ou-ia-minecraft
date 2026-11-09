// Demande à tout le monde ("qqun a de la laine ?") : chaque bot calcule ce que ça lui coûterait d'aider
// et attend d'autant plus longtemps que c'est "chiant" pour lui. Celui à qui ça coûte le moins répond en premier,
// les autres lisent sa réponse dans le chat et continuent leur truc (pas de canal caché entre les bots).
// Le détail et des exemples sont dans docs/reactions-des-bots.md.

// Mots du chat -> objets de l'inventaire qui correspondent.
const MOTS_OBJETS = [
  [/laine/, (n) => n.endsWith('_wool')],
  [/diam/, (n) => n === 'diamond'],
  [/\bfer\b/, (n) => n === 'iron_ingot' || n === 'raw_iron'],
  [/bois|b[uû]che/, (n) => n.endsWith('_log')],
  [/planche/, (n) => n.endsWith('_planks')],
  [/pierre|cobble/, (n) => n === 'cobblestone'],
  [/charbon/, (n) => n === 'coal' || n === 'charcoal'],
  [/table|[ée]tabli/, (n) => n === 'crafting_table'],
  [/\bfour\b/, (n) => n === 'furnace'],
  [/pioche/, (n) => n.endsWith('_pickaxe')],
  [/[ée]p[ée]e/, (n) => n.endsWith('_sword')],
  [/\blit\b/, (n) => n.endsWith('_bed')],
];
const MOTS_BOUFFE = /bouffe|manger|viande|nourriture/;

// Combien de l'objet demandé j'ai (null si la demande ne parle d'aucun objet connu).
function objetDemande(texte, inventaire, registry) {
  const t = texte.toLowerCase();
  let correspond = null;
  if (MOTS_BOUFFE.test(t)) correspond = (n) => Boolean(registry.foodsByName[n]);
  for (const [mot, test] of MOTS_OBJETS) if (mot.test(t)) correspond = test;
  if (!correspond) return null;
  return inventaire.filter((i) => correspond(i.name)).reduce((s, i) => s + i.count, 0);
}

// Coût pour moi de m'occuper de la demande (0 = facile, environ 6 = très chiant).
function coutDemande({ possede, distance, occupe, serviable }) {
  let cout = possede === null ? 1 : (possede > 0 ? 0 : 2);
  cout += distance === null ? 1.5 : Math.min(distance / 20, 2);
  if (occupe) cout += 1;
  cout += 2 * (1 - serviable);
  return cout;
}

// Temps avant de réagir : 1,5 s + 2,5 s par point de coût.
function delaiReaction(cout) {
  return 1500 + cout * 2500;
}

// Un autre joueur que le demandeur a écrit depuis la demande : il s'en occupe, je laisse faire.
function dejaRepondu(chat, demandeur, depuis, moi) {
  return chat.some((m) => m.t > depuis && m.from !== demandeur && m.from !== moi);
}

// Un message qui cite un autre joueur s'adresse à lui : avant, les 3 bots répondaient à tout,
// ("je suis avec toi joueur 4" -> c'est Joueur6 qui répondait "ah ouais pas mal").
function citeUnAutre(texte, moi, joueurs, surnoms = {}) {
  return joueurs.some((j) => j !== moi && estCite(texte, [j, ...(surnoms[j] || [])]));
}

// Un joueur écrit rarement le pseudo en entier ("tom" pour "tomtom59") : on cherche le pseudo ou un surnom,
// en mot entier ("tom" ne doit pas être trouvé dans "atomes"). Un pseudo Minecraft n'a que lettres, chiffres et _.
function estCite(texte, noms) {
  const t = texte.toLowerCase().replace(/joueur\s+(\d)/g, 'joueur$1'); // "joueur 4" = "Joueur4"
  return noms.some((n) => new RegExp(`(^|[^a-z0-9_])${n.toLowerCase()}($|[^a-z0-9_])`).test(t));
}

// Messages sans contenu auxquels personne ne répond ("merci", "ok", "tkt"...) : sinon les bots
// se répondaient entre eux sans fin ("merci" -> "de rien" -> "tkt" -> "bonne chance").
function sansContenu(texte) {
  return /^(merci|ok|oki|okay|tkt|de rien|mdr|ptdr|gg|bonne chance|bon courage|ouais|oui|nan|non|cool|top|parfait|ah|oh)\b[\s!.?]*\S{0,10}$/i.test(texte.trim());
}

// Coordonnées données dans le chat ("je suis en 0 0", "-10 64 10") : "x z" ou "x y z".
function positionAnnoncee(texte) {
  const m = texte.match(/(-?\d{1,5})[\s,;/]+(-?\d{1,5})(?:[\s,;/]+(-?\d{1,5}))?/);
  if (!m) return null;
  return m[3] !== undefined ? { x: +m[1], y: +m[2], z: +m[3] } : { x: +m[1], z: +m[2] };
}

module.exports = { objetDemande, coutDemande, delaiReaction, dejaRepondu, citeUnAutre, estCite, sansContenu, positionAnnoncee };
