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

module.exports = { objetDemande, coutDemande, delaiReaction, dejaRepondu };
