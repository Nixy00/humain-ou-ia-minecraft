// Actions (outils) que le modèle peut choisir, et leur exécution avec Mineflayer.
// Toutes passent par le client de jeu, comme pour un humain : chat, déplacements,
// minage, fabrication, objets jetés (troc). Aucune commande d'administration.
//
// Les actions poser_bloc, cuire, coffres, equiper et dormir sont adaptées (en plus simple)
// de Mindcraft : Copyright (c) 2024 Kolby Nottingham, licence MIT,
// https://github.com/mindcraft-bots/mindcraft

const { goals, Movements } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { isHostile } = require('./perception');
const { frapper, delaiEntreCoups } = require('./humanizer');

// Champs communs. Leurs explications sont dans la consigne système (prompt.js) et pas ici :
// répétées dans les 23 outils, elles faisaient 40 % de la taille de chaque requête.
const OBJECTIF = { type: 'string', maxLength: 120 };
const NOTE = { type: 'string', maxLength: 120 };
const JOUEUR = { type: 'string', maxLength: 32 };
const ID_MC = { type: 'string', maxLength: 64 };
const COORD = { type: 'integer' };

function tool(name, description, properties, required = []) {
  return {
    name,
    description,
    parameters: { type: 'object', properties: { ...properties, objectif: OBJECTIF, note: NOTE }, required },
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
  tool('aller_a', 'Marcher jusqu\'à des coordonnées.', { x: COORD, y: COORD, z: COORD }, ['x', 'y', 'z']),
  tool('suivre_joueur', 'Suivre un joueur pendant quelques secondes.', { joueur: JOUEUR, secondes: { type: 'integer', minimum: 5, maximum: 50 } }, ['joueur', 'secondes']),
  tool('regarder_joueur', 'Tourner la tête vers un joueur.', { joueur: JOUEUR }, ['joueur']),
  tool('poser_bloc', 'Poser un bloc de ton inventaire à des coordonnées proches (pour construire).', { bloc: ID_MC, x: COORD, y: COORD, z: COORD }, ['bloc', 'x', 'y', 'z']),
  tool('casser_bloc', 'Casser le bloc situé à des coordonnées précises.', { x: COORD, y: COORD, z: COORD }, ['x', 'y', 'z']),
  tool('equiper', 'Prendre un objet en main ou mettre une armure.', { objet: ID_MC }, ['objet']),
  tool('jeter', 'Jeter des objets de ton inventaire par terre.', { objet: ID_MC, quantite: { type: 'integer', minimum: 1, maximum: 64 } }, ['objet', 'quantite']),
  tool('deposer_coffre', 'Ranger des objets dans le coffre le plus proche.', { objet: ID_MC, quantite: { type: 'integer', minimum: 1, maximum: 64 } }, ['objet', 'quantite']),
  tool('prendre_coffre', 'Prendre des objets dans le coffre le plus proche.', { objet: ID_MC, quantite: { type: 'integer', minimum: 1, maximum: 64 } }, ['objet', 'quantite']),
  tool('voir_coffre', 'Regarder ce que contient le coffre le plus proche.', {}),
  tool('cuire', 'Cuire ou fondre des objets dans un four proche (ex. raw_iron, beef). Il faut du combustible (charbon ou bois).', { objet: ID_MC, quantite: { type: 'integer', minimum: 1, maximum: 5 } }, ['objet', 'quantite']),
  tool('dormir', 'Dormir dans le lit le plus proche (la nuit seulement).', {}),
  tool('fuir', 'S\'éloigner du monstre le plus proche.', {}),
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
  // Sur un vrai serveur, 97 % des messages font 10 mots ou moins : au-delà de 12, on fait reformuler.
  if (typeof args.message === 'string' && args.message.trim().split(/\s+/).length > 12) {
    errors.push('message trop long, un joueur écrit court (quelques mots)');
  }
  // Un joueur n'écrit pas "oak_log" dans le chat : on refuse et le modèle reformule.
  if (typeof args.message === 'string' && /[a-z]+_[a-z]+/i.test(args.message)) {
    errors.push('écris comme un joueur, sans identifiant avec "_" (ex. oak_log -> bois)');
  }
  if ('x' in args && bot.entity && bot.entity.position.distanceTo(new Vec3(args.x, args.y, args.z)) > 64) {
    errors.push('ces coordonnées sont trop loin de toi (plus de 64 blocs)');
  }
  return errors;
}

// Résout "oak_log" exactement, sinon "log" -> tous les blocs dont le nom contient "log".
// Certains objets ne se trouvent pas tels quels : on mine le bloc qui les donne.
const BLOC_QUI_DONNE = { cobblestone: 'stone', cobbled_deepslate: 'deepslate', flint: 'gravel' };

function resolveBlocks(mcData, name) {
  name = BLOC_QUI_DONNE[name] || name;
  // Une bûche demandée (oak_log...) accepte toutes les essences : autour du spawn il ne reste parfois que du bouleau.
  if (name.endsWith('_log')) return mcData.blocksArray.filter((b) => b.name.endsWith('_log') && !b.name.startsWith('stripped')).map((b) => b.id);
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
    // Sans pioche, la pierre et les minerais ne donnent rien : on le dit tout de suite au modèle.
    const outils = mcData.blocks[ids[0]].harvestTools;
    if (outils && !bot.inventory.items().some((i) => outils[i.type])) {
      throw new Error(`il te faut une pioche pour ${bloc} : coupe du bois, fais des planches, une table de craft puis une pioche en bois`);
    }

    // Pendant la récolte on a le droit de creuser (sinon les blocs dans la roche sont inatteignables),
    // et on abandonne vite un bloc inatteignable pour essayer le suivant.
    const avant = { movements: bot.pathfinder.movements, timeout: bot.pathfinder.thinkTimeout };
    const moves = new Movements(bot);
    moves.canDig = true;
    bot.pathfinder.setMovements(moves);
    bot.pathfinder.thinkTimeout = 3000;

    const nbObjets = () => bot.inventory.items().reduce((s, i) => s + i.count, 0);
    const objetsAvant = nbObjets();
    let mined = 0;
    let rates = 0;
    const inatteignables = new Set();
    const fin = Date.now() + 45000; // on rend la main avant la limite de 60 s d'une action
    try {
      while (mined < quantite && rates < 3 && Date.now() < fin) {
        const positions = bot.findBlocks({ matching: ids, maxDistance: 32, count: 10 });
        const pos = positions.find((p) => !inatteignables.has(p.toString()));
        if (!pos) break;
        const target = bot.blockAt(pos);
        try {
          await allerAvecLimite(bot, new goals.GoalLookAtBlock(target.position, bot.world), 15000);
        } catch {
          inatteignables.add(pos.toString());
          rates++;
          continue;
        }
        const toolItem = bot.pathfinder.bestHarvestTool(target);
        if (toolItem) await bot.equip(toolItem, 'hand');
        await bot.dig(target);
        mined++;
        // Aller ramasser l'objet tombé, là où il a atterri (il peut rouler ou tomber plus bas).
        await sleep(400);
        const objet = bot.nearestEntity((e) => e.name === 'item' && e.position.distanceTo(target.position) < 6);
        if (objet) {
          const p = objet.position;
          try {
            await allerAvecLimite(bot, new goals.GoalNear(p.x, p.y, p.z, 0.5), 5000);
          } catch { /* objet hors d'atteinte : tant pis */ }
          await sleep(300);
        }
      }
    } finally {
      bot.pathfinder.setMovements(avant.movements);
      bot.pathfinder.thinkTimeout = avant.timeout;
    }
    if (mined === 0) throw new Error(`aucun ${bloc} atteignable à moins de 32 blocs, essaie d'explorer`);
    // On annonce ce qui est vraiment entré dans l'inventaire, pas seulement les blocs cassés.
    const gagnes = nbObjets() - objetsAvant;
    if (gagnes === 0) throw new Error(`${mined} bloc(s) cassé(s) mais rien ramassé`);
    return `${gagnes} objet(s) ramassé(s) en cassant ${mined} ${bloc}${mined < quantite ? ' (pas plus pour le moment)' : ''}`;
  },

  async fabriquer(bot, { objet, quantite }, { mcData }) {
    const item = mcData.itemsByName[objet];
    if (!item) throw new Error(`objet inconnu : ${objet}`);
    let table = null;
    let recipe = bot.recipesFor(item.id, null, 1, null)[0];
    if (!recipe) {
      table = bot.findBlock({ matching: mcData.blocksByName.crafting_table.id, maxDistance: 32 });
      if (table) {
        await bot.pathfinder.goto(new goals.GoalLookAtBlock(table.position, bot.world));
        recipe = bot.recipesFor(item.id, null, 1, table)[0];
      }
    }
    if (!recipe) {
      // On dit au modèle ce qui manque vraiment (avant : "il faut un établi" alors qu'il manquait des planches).
      // Une recette a parfois plusieurs variantes (planches de chêne, d'épicéa...) : on garde celle
      // à laquelle il manque le moins de choses, et on ne liste que ce qui manque.
      const manquePour = (r) => r.delta
        .filter((d) => d.count < 0 && countItem(bot, mcData.items[d.id].name) < -d.count)
        .map((d) => `${-d.count - countItem(bot, mcData.items[d.id].name)} ${mcData.items[d.id].name}`);
      const variantes = bot.recipesAll(item.id, null, true);
      if (variantes.length === 0) throw new Error(`${objet} ne se fabrique pas`);
      const modele = variantes.reduce((a, b) => (manquePour(b).length < manquePour(a).length ? b : a));
      const manque = manquePour(modele);
      if (modele.requiresTable && !table) manque.push('une table de craft posée à côté (poser_bloc crafting_table)');
      throw new Error(`il te manque : ${manque.join(', ')}`);
    }
    // On fabrique autant que possible avec ce qu'on a (sinon "missing ingredient" si on en demande trop).
    const possible = Math.min(...recipe.delta.filter((d) => d.count < 0).map((d) => Math.floor(countItem(bot, mcData.items[d.id].name) / -d.count)));
    const before = countItem(bot, objet);
    await bot.craft(recipe, Math.min(quantite, possible), table);
    await sleep(500); // le temps que le serveur mette l'inventaire à jour
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

  async se_defendre(bot, args, { style }) {
    const mob = bot.nearestEntity((e) => isHostile(e) && bot.entity.position.distanceTo(e.position) < 12);
    if (!mob) throw new Error('aucun monstre proche');
    const weapon = bot.inventory.items().find((i) => i.name.endsWith('_sword')) ?? bot.inventory.items().find((i) => i.name.endsWith('_axe'));
    if (weapon) await bot.equip(weapon, 'hand');
    bot.pathfinder.setGoal(new goals.GoalFollow(mob, 2), true);
    const end = Date.now() + 15000;
    while (mob.isValid && Date.now() < end) {
      if (bot.entity.position.distanceTo(mob.position) < 3.5) frapper(bot, mob, style.rateCoup);
      await sleep(delaiEntreCoups());
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

  async aller_a(bot, { x, y, z }) {
    await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1));
    return `arrivé en ${x} ${y} ${z}`;
  },

  async suivre_joueur(bot, { joueur, secondes }) {
    bot.pathfinder.setGoal(new goals.GoalFollow(playerEntity(bot, joueur), 3), true);
    await sleep(secondes * 1000);
    bot.pathfinder.setGoal(null);
    return `${joueur} suivi pendant ${secondes} s`;
  },

  async regarder_joueur(bot, { joueur }) {
    const e = playerEntity(bot, joueur);
    await bot.lookAt(e.position.offset(0, e.height, 0));
    return `tu regardes ${joueur}`;
  },

  async poser_bloc(bot, { bloc, x, y, z }) {
    const item = findItem(bot, bloc);
    const cible = new Vec3(x, y, z);
    const actuel = bot.blockAt(cible);
    if (!actuel) throw new Error('cet endroit est trop loin');
    if (!BLOCS_VIDES.includes(actuel.name)) throw new Error(`il y a déjà ${actuel.name} à cet endroit`);

    // Il faut un bloc voisin sur lequel "s'appuyer" pour poser le nouveau bloc.
    let appui = null;
    let face = null;
    for (const d of DIRECTIONS) {
      const voisin = bot.blockAt(cible.plus(d));
      if (voisin && !BLOCS_VIDES.includes(voisin.name)) {
        appui = voisin;
        face = new Vec3(-d.x, -d.y, -d.z);
        break;
      }
    }
    if (!appui) throw new Error('rien autour pour poser le bloc dessus');

    // Trop loin : on s'approche. Debout sur la case : on se décale.
    if (bot.entity.position.distanceTo(cible) > 4.5) {
      await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 3));
    }
    const pieds = bot.entity.position.floored();
    if (pieds.equals(cible) || pieds.offset(0, 1, 0).equals(cible)) {
      await bot.pathfinder.goto(new goals.GoalInvert(new goals.GoalNear(x, y, z, 2)));
    }
    await bot.equip(item, 'hand');
    await bot.placeBlock(appui, face);
    return `${bloc} posé en ${x} ${y} ${z}`;
  },

  async casser_bloc(bot, { x, y, z }) {
    const b = bot.blockAt(new Vec3(x, y, z));
    if (!b || BLOCS_VIDES.includes(b.name)) throw new Error('il n\'y a pas de bloc à cet endroit');
    await bot.pathfinder.goto(new goals.GoalLookAtBlock(b.position, bot.world));
    const outil = bot.pathfinder.bestHarvestTool(b);
    if (outil) await bot.equip(outil, 'hand');
    await bot.dig(b);
    return `${b.name} cassé`;
  },

  async equiper(bot, { objet }) {
    const item = findItem(bot, objet);
    let place = 'hand';
    if (objet.endsWith('_helmet')) place = 'head';
    if (objet.endsWith('_chestplate')) place = 'torso';
    if (objet.endsWith('_leggings')) place = 'legs';
    if (objet.endsWith('_boots')) place = 'feet';
    if (objet === 'shield') place = 'off-hand';
    await bot.equip(item, place);
    return `${objet} équipé`;
  },

  async jeter(bot, { objet, quantite }) {
    const item = findItem(bot, objet);
    const n = Math.min(quantite, countItem(bot, objet));
    await bot.toss(item.type, null, n);
    return `${n} ${objet} jeté(s)`;
  },

  async deposer_coffre(bot, { objet, quantite }, { mcData }) {
    const item = findItem(bot, objet);
    const n = Math.min(quantite, countItem(bot, objet));
    const coffre = await ouvrirCoffre(bot, mcData);
    try {
      await coffre.deposit(item.type, null, n);
    } finally {
      coffre.close();
    }
    return `${n} ${objet} rangé(s) dans le coffre`;
  },

  async prendre_coffre(bot, { objet, quantite }, { mcData }) {
    const coffre = await ouvrirCoffre(bot, mcData);
    try {
      const items = coffre.containerItems().filter((i) => i.name === objet);
      const dispo = items.reduce((s, i) => s + i.count, 0);
      if (dispo === 0) throw new Error(`pas de ${objet} dans le coffre`);
      const n = Math.min(quantite, dispo);
      await coffre.withdraw(items[0].type, null, n);
      return `${n} ${objet} pris dans le coffre`;
    } finally {
      coffre.close();
    }
  },

  async voir_coffre(bot, args, { mcData }) {
    const coffre = await ouvrirCoffre(bot, mcData);
    const contenu = coffre.containerItems().map((i) => `${i.name} x${i.count}`);
    coffre.close();
    return contenu.length ? `le coffre contient : ${contenu.join(', ')}` : 'le coffre est vide';
  },

  async cuire(bot, { objet, quantite }, { mcData }) {
    const item = findItem(bot, objet);
    const n = Math.min(quantite, countItem(bot, objet));
    const bloc = bot.findBlock({ matching: mcData.blocksByName.furnace.id, maxDistance: 32 });
    if (!bloc) throw new Error('aucun four à proximité');

    // Combustible : du charbon (8 cuissons chacun) ou du bois (1 cuisson chacun, on simplifie).
    const combustible = bot.inventory.items().find((i) => i.name !== objet && COMBUSTIBLES.some((c) => i.name.endsWith(c)));
    if (!combustible) throw new Error('pas de combustible (charbon ou bois)');
    const nbCombustible = combustible.name.endsWith('coal') ? Math.ceil(n / 8) : n;
    if (combustible.count < nbCombustible) throw new Error(`pas assez de ${combustible.name}`);

    await bot.pathfinder.goto(new goals.GoalLookAtBlock(bloc.position, bot.world));
    const four = await bot.openFurnace(bloc);
    let cuits = 0;
    try {
      if (!four.fuelItem()) await four.putFuel(combustible.type, null, nbCombustible);
      await four.putInput(item.type, null, n);
      // Une cuisson dure 10 secondes dans Minecraft.
      const fin = Date.now() + n * 10000 + 3000;
      while (cuits < n && Date.now() < fin) {
        await sleep(1000);
        if (four.outputItem()) {
          const sortie = await four.takeOutput();
          cuits += sortie ? sortie.count : 0;
        }
      }
    } finally {
      // On récupère ce qui n'a pas cuit (sinon les objets restent coincés dans le four).
      if (four.inputItem()) await four.takeInput().catch(() => {});
      four.close();
    }
    if (cuits === 0) throw new Error(`${objet} ne peut pas être cuit`);
    return `${cuits} ${objet} cuit(s)`;
  },

  async dormir(bot) {
    const lit = bot.findBlock({ matching: (b) => bot.isABed(b), maxDistance: 32 });
    if (!lit) throw new Error('aucun lit à proximité');
    await bot.pathfinder.goto(new goals.GoalLookAtBlock(lit.position, bot.world));
    await bot.sleep(lit); // erreur si ce n'est pas la nuit ou s'il y a des monstres autour
    return 'tu dors';
  },

  async fuir(bot) {
    const mob = bot.nearestEntity((e) => isHostile(e) && bot.entity.position.distanceTo(e.position) < 16);
    if (!mob) throw new Error('aucun monstre proche');
    const p = mob.position;
    await bot.pathfinder.goto(new goals.GoalInvert(new goals.GoalNear(p.x, p.y, p.z, 16)));
    return `tu t'es éloigné du ${mob.name}`;
  },
};

// Blocs que l'on peut remplacer en posant un bloc (vides ou herbes).
const BLOCS_VIDES = ['air', 'cave_air', 'water', 'lava', 'grass', 'short_grass', 'tall_grass', 'snow', 'fern', 'dead_bush'];
const DIRECTIONS = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const COMBUSTIBLES = ['coal', 'charcoal', '_planks', '_log'];

// Le pathfinder peut tourner en rond sans fin vers un point en l'air (ex. une bûche en haut d'un arbre) :
// on arrête le déplacement au bout de ms millisecondes.
async function allerAvecLimite(bot, goal, ms) {
  let timer;
  try {
    await Promise.race([
      bot.pathfinder.goto(goal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          bot.pathfinder.setGoal(null);
          reject(new Error('trop long'));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function findItem(bot, name) {
  const item = bot.inventory.items().find((i) => i.name === name);
  if (!item) throw new Error(`tu n'as pas de ${name}`);
  return item;
}

async function ouvrirCoffre(bot, mcData) {
  const bloc = bot.findBlock({ matching: mcData.blocksByName.chest.id, maxDistance: 32 });
  if (!bloc) throw new Error('aucun coffre à proximité');
  await bot.pathfinder.goto(new goals.GoalLookAtBlock(bloc.position, bot.world));
  return bot.openContainer(bloc);
}

// Exécute une action avec un délai maximal ; renvoie toujours { ok, result }.
async function execute(bot, name, args, ctx, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`action interrompue après ${timeoutMs / 1000} s`)), timeoutMs);
  });
  try {
    // On peut parler ou attendre dans son lit, mais pour le reste il faut se lever.
    if (bot.isSleeping && !['dormir', 'parler', 'murmurer', 'attendre'].includes(name)) await bot.wake();
    const result = await Promise.race([executors[name](bot, args, ctx), timeout]);
    return { ok: true, result };
  } catch (err) {
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    return { ok: false, result: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { TOOLS, executors, execute, checkArgs, resolveBlocks };
