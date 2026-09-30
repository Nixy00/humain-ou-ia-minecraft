// Actions (outils) que le modèle peut choisir, et leur exécution avec Mineflayer.
// Toutes passent par le client de jeu, comme pour un humain : chat, déplacements,
// minage, fabrication, objets jetés (troc). Aucune commande d'administration.

const { goals } = require('mineflayer-pathfinder');
const { isHostile } = require('./perception');

// Champ commun : le modèle peut noter son objectif courant, réaffiché au tour suivant.
const OBJECTIF = { type: 'string', maxLength: 120, description: 'Ton objectif actuel en quelques mots (optionnel).' };
const JOUEUR = { type: 'string', maxLength: 32, description: 'Pseudo exact du joueur.' };
const ID_MC = { type: 'string', maxLength: 64, description: 'Identifiant Minecraft en anglais, ex. oak_log, cobblestone, stick.' };

function tool(name, description, properties, required = []) {
  return {
    name,
    description,
    parameters: { type: 'object', properties: { ...properties, objectif: OBJECTIF }, required },
  };
}

const TOOLS = [
  tool('parler', 'Écrire un message dans le chat public.', { message: { type: 'string', minLength: 1, maxLength: 200 } }, ['message']),
  tool('murmurer', 'Envoyer un message privé à un joueur.', { joueur: JOUEUR, message: { type: 'string', minLength: 1, maxLength: 200 } }, ['joueur', 'message']),
  tool('aller_vers_joueur', "Se déplacer jusqu'à un joueur visible.", { joueur: JOUEUR }, ['joueur']),
  tool('collecter', 'Miner ou couper des blocs proches et ramasser ce qui tombe.', { bloc: ID_MC, quantite: { type: 'integer', minimum: 1, maximum: 16 } }, ['bloc', 'quantite']),
  tool('fabriquer', 'Fabriquer un objet (utilise un établi proche si la recette le demande). quantite = nombre de fabrications.', { objet: ID_MC, quantite: { type: 'integer', minimum: 1, maximum: 16 } }, ['objet', 'quantite']),
  tool('donner', "Aller vers un joueur et lui lancer des objets de ton inventaire (troc).", { joueur: JOUEUR, objet: ID_MC, quantite: { type: 'integer', minimum: 1, maximum: 64 } }, ['joueur', 'objet', 'quantite']),
  tool('manger', 'Manger de la nourriture de ton inventaire.', {}),
  tool('se_defendre', 'Attaquer le monstre hostile le plus proche (jamais un joueur).', {}),
  tool('explorer', 'Marcher dans une direction au hasard pour trouver des ressources.', {}),
  tool('attendre', 'Ne rien faire pendant quelques secondes.', { secondes: { type: 'integer', minimum: 1, maximum: 30 } }, ['secondes']),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Contrôles qui dépendent de l'état du jeu (le schéma ne peut pas les exprimer).
function checkArgs(bot, name, args) {
  const errors = [];
  if ('joueur' in args && !bot.players[args.joueur]) errors.push(`le joueur "${args.joueur}" n'est pas connecté`);
  if (args.joueur === bot.username) errors.push("tu ne peux pas te viser toi-même");
  // bot.chat exécute tout texte commençant par "/" comme une commande serveur (ex. /designer) :
  // le modèle, ou un joueur qui le manipule par le chat, pourrait voter ou agir hors des outils.
  if (typeof args.message === 'string' && args.message.trimStart().startsWith('/')) errors.push('un message ne peut pas commencer par "/"');
  return errors;
}

// Résout "oak_log" exactement, sinon "log" -> tous les blocs dont le nom contient "log".
function resolveBlocks(mcData, name) {
  const exact = mcData.blocksByName[name];
  if (exact) return [exact.id];
  return mcData.blocksArray.filter((b) => b.name.includes(name)).map((b) => b.id);
}

function countItem(bot, name) {
  return bot.inventory.items().filter((i) => i.name === name).reduce((s, i) => s + i.count, 0);
}

function playerEntity(bot, name) {
  const e = bot.players[name]?.entity;
  if (!e) throw new Error(`${name} n'est pas visible`);
  return e;
}

const executors = {
  async parler(bot, { message }) {
    bot.chat(message);
    return 'message envoyé';
  },

  async murmurer(bot, { joueur, message }) {
    bot.chat(`/msg ${joueur} ${message}`);
    return 'message privé envoyé';
  },

  async aller_vers_joueur(bot, { joueur }) {
    const p = playerEntity(bot, joueur).position;
    await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2));
    return `arrivé près de ${joueur}`;
  },

  async collecter(bot, { bloc, quantite }, { mcData }) {
    const ids = resolveBlocks(mcData, bloc);
    if (ids.length === 0) throw new Error(`bloc inconnu : ${bloc}`);
    let mined = 0;
    for (let i = 0; i < quantite; i++) {
      const target = bot.findBlock({ matching: ids, maxDistance: 32 });
      if (!target) break;
      await bot.pathfinder.goto(new goals.GoalLookAtBlock(target.position, bot.world));
      const toolItem = bot.pathfinder.bestHarvestTool(target);
      if (toolItem) await bot.equip(toolItem, 'hand');
      if (!target.canHarvest(bot.heldItem ? bot.heldItem.type : null)) {
        throw new Error(`il faut un meilleur outil pour ${target.name}`);
      }
      await bot.dig(target);
      mined++;
      // Aller sur l'emplacement pour ramasser l'objet tombé.
      try {
        await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 1));
      } catch { /* objet hors d'atteinte : tant pis */ }
      await sleep(300);
    }
    if (mined === 0) throw new Error(`aucun ${bloc} trouvé à moins de 32 blocs`);
    return `${mined} bloc(s) récolté(s)`;
  },

  async fabriquer(bot, { objet, quantite }, { mcData }) {
    const item = mcData.itemsByName[objet];
    if (!item) throw new Error(`objet inconnu : ${objet}`);
    let table = null;
    let recipe = bot.recipesFor(item.id, null, 1, null)[0];
    if (!recipe) {
      table = bot.findBlock({ matching: mcData.blocksByName.crafting_table.id, maxDistance: 32 });
      if (!table) throw new Error("pas de recette possible sans établi, et aucun établi à proximité");
      await bot.pathfinder.goto(new goals.GoalLookAtBlock(table.position, bot.world));
      recipe = bot.recipesFor(item.id, null, 1, table)[0];
    }
    if (!recipe) throw new Error(`ressources insuffisantes pour ${objet}`);
    const before = countItem(bot, objet);
    await bot.craft(recipe, quantite, table);
    return `${countItem(bot, objet) - before} ${objet} fabriqué(s)`;
  },

  async donner(bot, { joueur, objet, quantite }, { mcData }) {
    const item = mcData.itemsByName[objet];
    if (!item) throw new Error(`objet inconnu : ${objet}`);
    const have = countItem(bot, objet);
    if (have === 0) throw new Error(`tu n'as pas de ${objet}`);
    const target = playerEntity(bot, joueur);
    await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2));
    await bot.lookAt(target.position.offset(0, target.height, 0));
    const n = Math.min(quantite, have);
    await bot.toss(item.id, null, n);
    return `${n} ${objet} lancé(s) à ${joueur}`;
  },

  async manger(bot) {
    const food = bot.inventory.items().find((i) => bot.registry.foodsByName?.[i.name]);
    if (!food) throw new Error("pas de nourriture dans l'inventaire");
    if (bot.food >= 20) throw new Error("tu n'as pas faim");
    await bot.equip(food, 'hand');
    await bot.consume();
    return `${food.name} mangé`;
  },

  async se_defendre(bot) {
    const mob = bot.nearestEntity((e) => isHostile(e) && bot.entity.position.distanceTo(e.position) < 12);
    if (!mob) throw new Error('aucun monstre proche');
    const weapon = bot.inventory.items().find((i) => i.name.endsWith('_sword')) ?? bot.inventory.items().find((i) => i.name.endsWith('_axe'));
    if (weapon) await bot.equip(weapon, 'hand');
    bot.pathfinder.setGoal(new goals.GoalFollow(mob, 2), true);
    const end = Date.now() + 15000;
    while (mob.isValid && Date.now() < end) {
      if (bot.entity.position.distanceTo(mob.position) < 3.5) {
        await bot.lookAt(mob.position.offset(0, mob.height * 0.8, 0));
        bot.attack(mob);
      }
      await sleep(650); // cadence d'attaque d'un joueur, pas plus
    }
    bot.pathfinder.setGoal(null);
    return mob.isValid ? `${mob.name} toujours en vie` : `${mob.name} éliminé`;
  },

  async explorer(bot) {
    const angle = Math.random() * 2 * Math.PI;
    const dist = 15 + Math.random() * 15;
    const p = bot.entity.position;
    await bot.pathfinder.goto(new goals.GoalNearXZ(p.x + Math.cos(angle) * dist, p.z + Math.sin(angle) * dist, 2));
    return 'zone explorée';
  },

  async attendre(bot, { secondes }) {
    await sleep(secondes * 1000);
    return `attendu ${secondes} s`;
  },
};

// Exécute une action avec un délai maximal ; renvoie toujours { ok, result }.
async function execute(bot, name, args, ctx, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`action interrompue après ${timeoutMs / 1000} s`)), timeoutMs);
  });
  try {
    const result = await Promise.race([executors[name](bot, args, ctx), timeout]);
    return { ok: true, result };
  } catch (err) {
    bot.pathfinder.stop();
    bot.clearControlStates();
    return { ok: false, result: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { TOOLS, execute, checkArgs };
