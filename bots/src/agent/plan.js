// Prochaine étape pour obtenir un objet : c'est le code qui enchaîne les étapes (bois -> pioche -> pierre -> fer...),
// le modèle n'a plus qu'à faire l'étape affichée. Un petit modèle n'arrivait pas à enchaîner tout seul.

// Les objets qu'on ne fabrique pas : d'où ils viennent et l'outil qu'il faut.
const SOURCES = {
  oak_log: { bloc: 'oak_log' },
  cobblestone: { bloc: 'stone', outil: 'wooden_pickaxe' },
  coal: { bloc: 'coal_ore', outil: 'wooden_pickaxe' },
  raw_iron: { bloc: 'iron_ore', outil: 'stone_pickaxe', conseil: 'creuser vers y=16 ou chercher une grotte' },
  iron_ingot: { cuire: 'raw_iron' },
  diamond: { bloc: 'diamond_ore', outil: 'iron_pickaxe', conseil: 'creuser vers y=-58' },
};

// Une pioche plus forte remplace une plus faible.
const PIOCHES = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'];

// Objets qui se fabriquent sans table de craft (grille 2x2 de l'inventaire).
const SANS_TABLE = ['oak_planks', 'stick', 'crafting_table'];

// Toutes les essences de bois se valent : on compte les bûches et les planches ensemble.
function nombre(inv, item) {
  if (item === 'oak_log' || item === 'oak_planks') {
    const fin = item.replace('oak', '');
    return Object.entries(inv).filter(([n]) => n.endsWith(fin) && !n.startsWith('stripped')).reduce((s, [, c]) => s + c, 0);
  }
  if (PIOCHES.includes(item)) {
    return PIOCHES.slice(PIOCHES.indexOf(item)).reduce((s, p) => s + (inv[p] || 0), 0);
  }
  return inv[item] || 0;
}

// Renvoie la première chose à faire pour avoir n fois item (ou null si on l'a déjà).
// inv est modifié : ce qui sert pour une étape n'est plus disponible pour la suivante.
function etape(item, n, inv, recettes, profondeur = 0) {
  if (profondeur > 10) return null;
  const dispo = nombre(inv, item);
  if (dispo >= n) {
    inv[item] = (inv[item] || 0) - n;
    return null;
  }
  const manque = n - dispo;

  const source = SOURCES[item];
  if (source && source.cuire) {
    return etape(source.cuire, manque, inv, recettes, profondeur + 1)
      || etape('furnace', 1, inv, recettes, profondeur + 1)
      || `cuire ${source.cuire} (${manque}), avec du charbon ou du bois`;
  }
  if (source) {
    if (source.outil) {
      const outil = etape(source.outil, 1, inv, recettes, profondeur + 1);
      if (outil) return outil;
    }
    return `collecter ${source.bloc} (${manque})${source.conseil ? ', ' + source.conseil : ''}`;
  }

  const recette = recettes(item);
  if (!recette) return `trouver ${item}`;
  const [ingredients, resultat] = recette[0];
  const fois = Math.ceil(manque / resultat.craftedCount);
  for (const [ingredient, c] of Object.entries(ingredients)) {
    const avant = etape(ingredient, c * fois, inv, recettes, profondeur + 1);
    if (avant) return avant;
  }
  if (!SANS_TABLE.includes(item)) {
    const table = etape('crafting_table', 1, inv, recettes, profondeur + 1);
    if (table) return table;
  }
  return `fabriquer ${item}`;
}

// La mission est du texte libre : l'objet visé est le premier identifiant Minecraft qu'elle contient.
function objetDeMission(mission, registry) {
  const mots = String(mission || '').toLowerCase().match(/[a-z_]+/g) || [];
  return mots.find((m) => m.includes('_') && registry.itemsByName[m]) || null;
}

function prochaineEtape(item, inventaire, recettes) {
  const inv = {};
  for (const i of inventaire) inv[i.name] = (inv[i.name] || 0) + i.count;
  const texte = etape(item, 1, inv, recettes);
  // Les recettes sont écrites avec du chêne : avec des bûches de bouleau, il faut des planches de bouleau.
  const buche = inventaire.find((i) => i.name.endsWith('_log') && !i.name.startsWith('stripped'));
  if (texte === 'fabriquer oak_planks' && buche) return `fabriquer ${buche.name.replace('_log', '_planks')}`;
  return texte;
}

module.exports = { prochaineEtape, objetDeMission };
