// Actions (outils) que le modèle peut choisir, et leur exécution avec Mineflayer.
// Toutes passent par le client de jeu, comme pour un humain : chat, déplacements,
// minage, fabrication, objets jetés (troc). Aucune commande d'administration.
//
// Les actions poser_bloc, cuire, coffres, equiper et dormir sont adaptées (en plus simple)
// de Mindcraft : Copyright (c) 2024 Kolby Nottingham, licence MIT,
// https://github.com/mindcraft-bots/mindcraft

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { isHostile, ANIMAUX } = require('./perception');
const { frapper, delaiEntreCoups } = require('./humanizer');
const { plansCabane, trouverTerrain, choisirBloc, vide } = require('./construction');

// Champs communs. Leurs explications sont dans la consigne système (prompt.js) et pas ici :
// répétées dans les 23 outils, elles faisaient 40 % de la taille de chaque requête.
const NOTE = { type: 'string', maxLength: 120 };
const PROMESSE = { type: 'string', maxLength: 120 };
const PENSEE = { type: 'string', maxLength: 150 };
// Ce qu'il dit dans le chat en même temps que l'action (une seule décision pour la parole et l'action).
const DIRE = { type: 'string', maxLength: 200 };
const JOUEUR = { type: 'string', maxLength: 32 };
const ID_MC = { type: 'string', maxLength: 64 };
const COORD = { type: 'integer' };

function tool(name, description, properties, required = []) {
  return {
    name,
    description,
    parameters: { type: 'object', properties: { ...properties, dire: DIRE, pensee: PENSEE, note: NOTE, promesse: PROMESSE }, required },
  };
}

const TOOLS = [
  tool('continuer', "Garder ce que tu fais (ou rester là si tu ne fais rien) : pratique pour juste répondre avec dire.", {}),
  tool('aller_vers_joueur', "Se déplacer jusqu'à un joueur visible.", { joueur: JOUEUR }, ['joueur']),
  tool('collecter', 'Miner ou couper des blocs proches et ramasser ce qui tombe.', { bloc: ID_MC, quantite: { type: 'integer', minimum: 1, maximum: 16 } }, ['bloc', 'quantite']),
  tool('fabriquer', 'Fabriquer un objet (utilise un établi proche si la recette le demande). quantite = nombre de fabrications.', { objet: ID_MC, quantite: { type: 'integer', minimum: 1, maximum: 16 } }, ['objet', 'quantite']),
  tool('donner', "Aller vers un joueur et lui lancer des objets de ton inventaire (troc).", { joueur: JOUEUR, objet: ID_MC, quantite: { type: 'integer', minimum: 1, maximum: 64 } }, ['joueur', 'objet', 'quantite']),
  tool('manger', 'Manger de la nourriture de ton inventaire.', {}),
  tool('se_defendre', 'Attaquer le monstre hostile le plus proche (jamais un joueur).', {}),
  tool('chasser', 'Tuer un animal proche (vache, cochon, poulet, mouton, lapin) et ramasser ce qui tombe. animal (optionnel) = cow, sheep...', { animal: { type: 'string', maxLength: 16 } }),
  tool('explorer', 'Partir explorer plus loin (30 à 60 blocs, en gardant à peu près la même direction) pour trouver des ressources ou des animaux.', {}),
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
  tool('creuser', 'Creuser droit vers le bas (pour descendre vers les minerais : fer vers y=16, diamant vers y=-58).', { blocs: { type: 'integer', minimum: 1, maximum: 20 } }, ['blocs']),
  tool('remonter', 'Remonter à la surface.', {}),
  tool('monter', 'Monter sur place en posant des blocs sous tes pieds (sauter + poser), pour sortir d\'un trou ou atteindre un endroit en hauteur.', { blocs: { type: 'integer', minimum: 1, maximum: 10 } }, ['blocs']),
  tool('construire', 'Construire une cabane de 5x5 près de toi (environ 70 blocs : cobblestone ou planches). Relance-la pour continuer le chantier.', {}),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Blocs qu'un joueur pose sans regret pour monter ou faire un pont.
const BLOCS_PILIER = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack', 'andesite', 'diorite', 'granite', 'tuff', 'gravel', 'sand'];

// Les actions de jeu (miner, fabriquer, cuire, coffres...) viennent de Mindcraft (src/mindcraft, licence MIT) :
// notre version maison ratait trop souvent. Mindcraft écrit ses messages dans bot.output et
// regarde bot.interrupt_code pour s'arrêter : on relie ça à notre bot.interrompre.
let skills = null;
async function mindcraft(bot, nom, ...args) {
  if (!skills) {
    skills = await import('../mindcraft/skills.mjs');
    (await import('../mindcraft/mcdata.mjs')).init(bot.version);
  }
  if (!bot.modes) {
    bot.modes = { isOn: () => false, pause() {}, unpause() {} };
    Object.defineProperty(bot, 'interrupt_code', { get: () => bot.interrompre });
  }
  bot.output = '';
  const ok = await skills[nom](bot, ...args);
  const texte = bot.output.trim().replace(/\n/g, ' ') || 'fait';
  if (ok === false) throw new Error(texte);
  return texte;
}

// Contrôles qui dépendent de l'état du jeu (le schéma ne peut pas les exprimer).
function checkArgs(bot, name, args) {
  const errors = [];
  if ('joueur' in args && !bot.players[args.joueur]) errors.push(`le joueur "${args.joueur}" n'est pas connecté`);
  if (args.joueur === bot.username) errors.push("tu ne peux pas te viser toi-même");
  // bot.chat exécute tout texte commençant par "/" comme une commande serveur (ex. /designer) :
  // le modèle, ou un joueur qui le manipule par le chat, pourrait voter ou agir hors des outils.
  const texte = typeof args.dire === 'string' ? args.dire : args.message;
  if (typeof texte === 'string' && texte.trimStart().startsWith('/')) errors.push('un message ne peut pas commencer par "/"');
  // Affamé sans nourriture, le builder a choisi "manger" 23 fois de suite : on refuse et il choisit autre chose.
  if (name === 'manger' && bot.inventory && !bot.inventory.items().some((i) => bot.registry.foodsByName[i.name])) {
    errors.push("tu n'as rien à manger : chasse un animal (chasser) ou explore pour en trouver");
  }
  // Seul sur le serveur, il n'a personne à qui parler (il écrivait "t es ou" dans le vide).
  if (name === 'parler' && bot.players && Object.keys(bot.players).length <= 1) {
    errors.push("personne d'autre n'est connecté, inutile de parler : fais autre chose");
  }
  // Sur un vrai serveur, 97 % des messages font 10 mots ou moins : au-delà de 12, on fait reformuler.
  if (typeof texte === 'string' && texte.trim().split(/\s+/).length > 12) {
    errors.push('message trop long, un joueur écrit court (quelques mots)');
  }
  // Un joueur n'écrit pas "oak_log" dans le chat : on refuse et le modèle reformule.
  if (typeof texte === 'string' && /[a-z]+_[a-z]+/i.test(texte)) {
    errors.push('écris comme un joueur, sans identifiant avec "_" (ex. oak_log -> bois)');
  }
  if ('x' in args && bot.entity && bot.entity.position.distanceTo(new Vec3(args.x, args.y, args.z)) > 64) {
    errors.push('ces coordonnées sont trop loin de toi (plus de 64 blocs)');
  }
  return errors;
}

function playerEntity(bot, name) {
  const e = bot.players[name]?.entity;
  if (!e) throw new Error(`${name} n'est pas visible`);
  return e;
}

const executors = {
  // Le cerveau garde l'action en cours (agent.js) : rien à exécuter ici.
  async continuer() {
    return 'tu continues';
  },

  async parler(bot, { message }) {
    bot.chat(message);
    return 'message envoyé';
  },

  async murmurer(bot, { joueur, message }) {
    bot.chat(`/msg ${joueur} ${message}`);
    return 'message privé envoyé';
  },

  async aller_vers_joueur(bot, { joueur }) {
    // Il réessayait 6 fois de suite "Could not find SAHYGO" alors que le joueur était juste trop loin.
    if (!bot.players[joueur].entity) throw new Error(`${joueur} est trop loin pour que tu le voies : demande-lui ses coordonnées puis utilise aller_a`);
    return mindcraft(bot, 'goToPlayer', joueur, 2);
  },

  async collecter(bot, args) {
    let bloc = nomObjet(bot, args.bloc);
    // Une bûche demandée accepte toutes les essences : autour du spawn il ne reste parfois que du bouleau.
    if (bloc.endsWith('_log')) {
      const proche = bot.findBlock({ matching: (b) => b.name.endsWith('_log') && !b.name.startsWith('stripped'), maxDistance: 64 });
      if (proche) bloc = proche.name;
    }
    return mindcraft(bot, 'collectBlock', bloc, args.quantite);
  },

  async fabriquer(bot, args) {
    const objet = nomObjet(bot, args.objet);
    if (!bot.registry.itemsByName[objet]) throw new Error(`objet inconnu : ${args.objet} (utilise l'identifiant Minecraft anglais, ex. oak_planks)`);
    return mindcraft(bot, 'craftRecipe', objet, args.quantite);
  },

  async donner(bot, { joueur, objet, quantite }) {
    return mindcraft(bot, 'giveToPlayer', nomObjet(bot, objet), joueur, quantite);
  },

  async manger(bot) {
    const food = bot.inventory.items().find((i) => bot.registry.foodsByName?.[i.name]);
    if (!food) throw new Error("pas de nourriture dans l'inventaire");
    if (bot.food >= 20) throw new Error("tu n'as pas faim");
    await bot.equip(food, 'hand');
    await bot.consume();
    return `${food.name} mangé`;
  },

  async chasser(bot, args, { style }) {
    // animal précis (ex. sheep pour la laine d'un lit), sinon le plus proche.
    const voulu = (e) => (args.animal ? e.name === args.animal : ANIMAUX.includes(e.name));
    const animal = bot.nearestEntity((e) => voulu(e) && bot.entity.position.distanceTo(e.position) < 48);
    if (!animal) throw new Error(`aucun ${args.animal || 'animal'} à moins de 48 blocs, explore plus loin dans une direction`);
    const arme = bot.inventory.items().find((i) => i.name.endsWith('_sword')) ?? bot.inventory.items().find((i) => i.name.endsWith('_axe'));
    if (arme) await bot.equip(arme, 'hand');
    bot.pathfinder.setGoal(new goals.GoalFollow(animal, 1), true);
    const fin = Date.now() + 20000;
    while (animal.isValid && Date.now() < fin && !bot.interrompre) {
      if (bot.entity.position.distanceTo(animal.position) < 3.5) frapper(bot, animal, style.rateCoup);
      await sleep(delaiEntreCoups());
    }
    bot.pathfinder.setGoal(null);
    if (animal.isValid) throw new Error(`le ${animal.name} s'est enfui`);
    // Ramasser ce qui est tombé (viande, cuir, laine...) : dans un test il tuait le poulet sans prendre la viande.
    await sleep(500);
    return `${animal.name} tué. ${await mindcraft(bot, 'pickupNearbyItems')}`;
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
    // Comme un joueur qui cherche quelque chose : il garde à peu près la même direction d'une fois sur l'autre
    // et va assez loin (avant : direction au hasard à 15-30 blocs, il tournait en rond dans la même zone).
    if (bot.capExploration === undefined) bot.capExploration = Math.random() * 2 * Math.PI;
    const angle = bot.capExploration + (Math.random() - 0.5) * 0.8;
    const dist = 30 + Math.random() * 30;
    const p = bot.entity.position;
    try {
      await allerAvecLimite(bot, new goals.GoalNearXZ(p.x + Math.cos(angle) * dist, p.z + Math.sin(angle) * dist, 3), 40000);
    } catch {
      bot.capExploration = undefined; // bloqué (mer, falaise...) : la prochaine fois, une autre direction
      throw new Error('passage bloqué dans cette direction, essaie une autre fois');
    }
    return `zone explorée (${Math.round(bot.entity.position.distanceTo(p))} blocs parcourus)`;
  },

  async attendre(bot, { secondes }) {
    await patienter(bot, secondes * 1000);
    return `attendu ${secondes} s`;
  },

  async aller_a(bot, { x, y, z }) {
    return mindcraft(bot, 'goToPosition', x, y, z, 1);
  },

  async suivre_joueur(bot, { joueur, secondes }) {
    bot.pathfinder.setGoal(new goals.GoalFollow(playerEntity(bot, joueur), 3), true);
    await patienter(bot, secondes * 1000);
    bot.pathfinder.setGoal(null);
    return `${joueur} suivi pendant ${secondes} s`;
  },

  async regarder_joueur(bot, { joueur }) {
    const e = playerEntity(bot, joueur);
    await bot.lookAt(e.position.offset(0, e.height, 0));
    return `tu regardes ${joueur}`;
  },

  async poser_bloc(bot, { bloc, x, y, z }) {
    return mindcraft(bot, 'placeBlock', nomObjet(bot, bloc), x, y, z);
  },

  async casser_bloc(bot, { x, y, z }) {
    return mindcraft(bot, 'breakBlockAt', x, y, z);
  },

  async equiper(bot, { objet }) {
    return mindcraft(bot, 'equip', nomObjet(bot, objet));
  },

  async jeter(bot, { objet, quantite }) {
    return mindcraft(bot, 'discard', nomObjet(bot, objet), quantite);
  },

  async deposer_coffre(bot, { objet, quantite }) {
    return mindcraft(bot, 'putInChest', nomObjet(bot, objet), quantite);
  },

  async prendre_coffre(bot, { objet, quantite }) {
    return mindcraft(bot, 'takeFromChest', nomObjet(bot, objet), quantite);
  },

  async voir_coffre(bot) {
    return mindcraft(bot, 'viewChest');
  },

  async cuire(bot, { objet, quantite }) {
    return mindcraft(bot, 'smeltItem', nomObjet(bot, objet), quantite);
  },

  async dormir(bot) {
    return mindcraft(bot, 'goToBed');
  },

  async fuir(bot) {
    return mindcraft(bot, 'avoidEnemies', 16);
  },

  async creuser(bot, { blocs }) {
    return mindcraft(bot, 'digDown', blocs);
  },

  async construire(bot) {
    // Le chantier est gardé sur le bot : on reprend là où on s'était arrêté.
    if (!bot.chantier) {
      const origine = trouverTerrain(bot);
      if (!origine) throw new Error("pas d'endroit plat et dégagé de 5x5 ici, va un peu plus loin");
      bot.chantier = { origine, restants: plansCabane(origine) };
    }
    const c = bot.chantier;
    let poses = 0;
    const fin = Date.now() + 45000; // on rend la main avant la limite de 60 s d'une action
    while (c.restants.length > 0 && Date.now() < fin && !bot.interrompre) {
      const b = c.restants[0];
      if (!vide(bot, b.pos)) { // déjà posé (ou un bloc naturel qui fait l'affaire)
        c.restants.shift();
        continue;
      }
      const bloc = choisirBloc(bot, b.partie);
      if (!bloc) throw new Error(`il te manque des blocs pour ${b.partie === 'toit' ? 'le toit' : 'les murs'} (planches ou cobblestone), encore ${c.restants.length} à poser`);
      try {
        await mindcraft(bot, 'placeBlock', bloc.name, b.pos.x, b.pos.y, b.pos.z);
        poses++;
        c.restants.shift();
      } catch {
        // Bloc impossible à poser pour l'instant : on le remet à la fin, 3 essais maximum.
        b.essais = (b.essais || 0) + 1;
        c.restants.shift();
        if (b.essais < 3) c.restants.push(b);
      }
    }
    const o = c.origine;
    if (c.restants.length === 0) {
      bot.chantier = null;
      bot.cabaneFinie = true;
      return `cabane finie en ${o.x} ${o.z} (${poses} blocs posés cette fois)`;
    }
    return `cabane en ${o.x} ${o.z} : ${poses} blocs posés, encore ${c.restants.length} (relance construire)`;
  },

  // Le geste du joueur : regarder ses pieds, sauter et poser un bloc dessous au sommet du saut.
  // Mindcraft ne sait pas le faire : pour poser un bloc là où il se tient, il s'écarte d'abord.
  async monter(bot, { blocs }) {
    const bloc = bot.inventory.items().find((i) => BLOCS_PILIER.includes(i.name));
    if (!bloc) throw new Error('il te faut des blocs à poser (dirt, cobblestone...)');
    await bot.equip(bloc, 'hand');
    await bot.look(bot.entity.yaw, -Math.PI / 2, true); // regarder droit vers le bas
    let poses = 0;
    for (let i = 0; i < blocs && !bot.interrompre; i++) {
      const dessus = bot.blockAt(bot.entity.position.offset(0, 2, 0));
      if (dessus && dessus.boundingBox === 'block') break; // plafond : on ne peut plus monter
      const depart = Math.floor(bot.entity.position.y);
      const sol = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      bot.setControlState('jump', true);
      for (let t = 0; t < 20 && bot.entity.position.y < depart + 1; t++) await sleep(50); // attendre le haut du saut
      bot.setControlState('jump', false);
      try {
        await bot.placeBlock(sol, new Vec3(0, 1, 0));
        poses++;
      } catch { /* raté (trop tôt ou trop tard) : on réessaie au saut suivant */ }
      await sleep(250);
      if (!bot.inventory.items().some((it) => it.name === bloc.name)) break;
    }
    if (poses === 0) throw new Error("impossible de poser un bloc sous toi ici");
    return `${poses} bloc(s) posé(s) sous toi, tu es à y=${Math.floor(bot.entity.position.y)}`;
  },

  async remonter(bot) {
    // goToSurface de Mindcraft vise directement la surface (100 blocs plus haut) : trop loin pour la
    // recherche de chemin (limitée à 96 blocs). On monte donc par paliers de 30 blocs.
    const p = bot.entity.position;
    let surface = Math.floor(p.y);
    for (let y = 320; y > p.y; y--) {
      const b = bot.blockAt(new Vec3(p.x, y, p.z));
      if (b && !['air', 'cave_air', 'void_air'].includes(b.name)) {
        surface = y + 1;
        break;
      }
    }
    while (bot.entity.position.y < surface - 1 && !bot.interrompre) {
      const avant = bot.entity.position.y;
      await mindcraft(bot, 'goToGoal', new goals.GoalY(Math.min(surface, Math.floor(avant) + 30)));
      if (bot.entity.position.y <= avant) throw new Error('impossible de monter plus haut ici');
    }
    return `tu es remonté (y=${Math.round(bot.entity.position.y)})`;
  },
};

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

// Attendre, mais s'arrêter tout de suite si un joueur lui parle (bot.interrompre, mis par agent.js).
async function patienter(bot, ms) {
  const fin = Date.now() + ms;
  while (Date.now() < fin && !bot.interrompre) await sleep(250);
}

// Le modèle écrit parfois l'objet en français ou sans l'essence de bois ("planches", "planks", "table de craft") :
// on le traduit en identifiant Minecraft au lieu de répondre "objet inconnu" (7 fois de suite dans un test).
const ALIAS = {
  planches: 'planks', planche: 'planks', bois: 'log', buches: 'log', 'bûches': 'log', 'bûche': 'log', buche: 'log',
  'table de craft': 'crafting_table', 'établi': 'crafting_table', etabli: 'crafting_table', 'table de travail': 'crafting_table',
  'bâton': 'stick', 'bâtons': 'stick', baton: 'stick', batons: 'stick', sticks: 'stick',
  pioche: 'wooden_pickaxe', hache: 'wooden_axe', 'épée': 'wooden_sword', pelle: 'wooden_shovel',
  four: 'furnace', coffre: 'chest', torche: 'torch', torches: 'torch',
};

function nomObjet(bot, objet) {
  let nom = String(objet).toLowerCase().trim();
  nom = ALIAS[nom] || nom.replace(/ /g, '_');
  if (bot.registry.itemsByName[nom]) return nom;
  // "planks" ou "log" sans essence : on prend l'essence de bois que le bot possède.
  if (nom === 'planks' || nom === 'log') {
    const bois = bot.inventory.items().find((i) => i.name.endsWith('_log'));
    return `${bois ? bois.name.replace('_log', '') : 'oak'}_${nom}`;
  }
  return nom;
}

// Exécute une action avec un délai maximal ; renvoie toujours { ok, result }.
async function execute(bot, name, args, ctx, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`action interrompue après ${timeoutMs / 1000} s`)), timeoutMs);
  });
  bot.interrompre = false; // remis à vrai par agent.js si un joueur lui parle pendant l'action
  try {
    // On peut parler ou attendre dans son lit, mais pour le reste il faut se lever.
    if (bot.isSleeping && !['dormir', 'parler', 'murmurer', 'attendre'].includes(name)) await bot.wake();
    const result = await Promise.race([executors[name](bot, args, ctx), timeout]);
    return { ok: true, result };
  } catch (err) {
    bot.interrompre = true; // sinon une action Mindcraft continue après la limite de temps
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    return { ok: false, result: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// On n'envoie au modèle que les outils qui servent dans la situation (moins de tokens par appel) :
// pas de chat sans autre joueur, pas de coffre sans coffre proche, pas de combat sans monstre...
const OUTILS_JOUEURS = ['aller_vers_joueur', 'suivre_joueur', 'regarder_joueur', 'donner'];
const OUTILS_COFFRE = ['voir_coffre', 'prendre_coffre', 'deposer_coffre'];
const OUTILS_COMBAT = ['se_defendre', 'fuir'];

function outilsUtiles(bot) {
  const pos = bot.entity.position;
  const autres = Object.keys(bot.players).length > 1;
  const coffre = bot.findBlock({ matching: bot.registry.blocksByName.chest.id, maxDistance: 32 });
  const monstre = bot.nearestEntity((e) => isHostile(e) && pos.distanceTo(e.position) < 16);
  const tod = bot.time.timeOfDay;
  const nuit = tod >= 12300 && tod <= 23850;
  // Affamé, il redemandait "manger" 45 fois malgré le refus (un appel payé à chaque fois) : on ne le propose plus.
  const aManger = bot.inventory.items().some((i) => bot.registry.foodsByName[i.name]);
  // chasser échouait 84 % du temps (aucun animal autour), construire 88 % (plus de blocs) : on ne les propose plus dans ces cas.
  const animal = bot.nearestEntity((e) => ANIMAUX.includes(e.name) && pos.distanceTo(e.position) < 48);
  const blocs = bot.inventory.items().some((i) => i.name === 'cobblestone' || i.name.endsWith('_planks'));
  return TOOLS.filter((t) => !(
    (!aManger && t.name === 'manger')
    || (!animal && t.name === 'chasser')
    || (!blocs && t.name === 'construire')
    || (!autres && OUTILS_JOUEURS.includes(t.name))
    || (!coffre && OUTILS_COFFRE.includes(t.name))
    || (!monstre && OUTILS_COMBAT.includes(t.name))
    || (!nuit && t.name === 'dormir')
    || (pos.y >= 50 && t.name === 'remonter')
  ));
}


// Outil de la réflexion (agent.js, reflechir) : toutes les quelques minutes, il fait le point.
const TEXTE = (n) => ({ type: 'string', maxLength: n });
const OUTIL_REFLEXION = {
  name: 'reflexion',
  description: 'Faire le point sur la partie.',
  parameters: {
    type: 'object',
    properties: {
      resume: TEXTE(400),
      avis: { type: 'array', items: { type: 'object', properties: { joueur: TEXTE(32), avis: TEXTE(120) } } },
      intention: TEXTE(200),
      nouvel_objectif: TEXTE(64),
      nombre: { type: 'integer', minimum: 1, maximum: 64 },
    },
    required: ['resume', 'intention'],
  },
};

module.exports = { TOOLS, executors, execute, checkArgs, nomObjet, outilsUtiles, OUTIL_REFLEXION };
