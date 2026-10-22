// Actions (outils) que le modèle peut choisir, et leur exécution avec Mineflayer.
// Toutes passent par le client de jeu, comme pour un humain : chat, déplacements,
// minage, fabrication, objets jetés (troc). Aucune commande d'administration.
//
// Les actions poser_bloc, cuire, coffres, equiper et dormir sont adaptées (en plus simple)
// de Mindcraft : Copyright (c) 2024 Kolby Nottingham, licence MIT,
// https://github.com/mindcraft-bots/mindcraft

const { goals, Movements } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { isHostile, ANIMAUX } = require('./perception');
const { frapper, delaiEntreCoups } = require('./humanizer');
const { plansCabane, trouverTerrain, choisirBloc, vide, plansStructure, sauverStructure, chargerStructure } = require('./construction');
const { NOURRITURE_ANIMAL, plansEnclos, dansEnclos, bleMur, terreASemer } = require('./ferme');

// Champs communs. Leurs explications sont dans la consigne système (prompt.js) et pas ici :
// répétées dans les 23 outils, elles faisaient 40 % de la taille de chaque requête.
const NOTE = { type: 'string', maxLength: 120 };
const PROMESSE = { type: 'string', maxLength: 120 };
const PENSEE = { type: 'string', maxLength: 300 };
const JOUEUR = { type: 'string', maxLength: 32 };
const ID_MC = { type: 'string', maxLength: 64 };
const COORD = { type: 'integer' };

function tool(name, description, properties, required = []) {
  return {
    name,
    description,
    parameters: { type: 'object', properties: { ...properties, pensee: PENSEE, note: NOTE, promesse: PROMESSE }, required },
  };
}

const TOOLS = [
  tool('aller_vers_joueur', "Se déplacer jusqu'à un joueur visible.", { joueur: JOUEUR }, ['joueur']),
  tool('collecter', 'Miner ou couper des blocs proches et ramasser ce qui tombe.', { bloc: ID_MC, quantite: { type: 'integer', minimum: 1, maximum: 16 } }, ['bloc', 'quantite']),
  tool('fabriquer', 'Fabriquer un objet (utilise un établi proche si la recette le demande). quantite = nombre de fabrications.', { objet: ID_MC, quantite: { type: 'integer', minimum: 1, maximum: 16 } }, ['objet', 'quantite']),
  tool('donner', "Aller vers un joueur et lui lancer des objets de ton inventaire (troc).", { joueur: JOUEUR, objet: ID_MC, quantite: { type: 'integer', minimum: 1, maximum: 64 } }, ['joueur', 'objet', 'quantite']),
  tool('manger', 'Manger de la nourriture de ton inventaire.', {}),
  tool('se_defendre', 'Attaquer le monstre hostile le plus proche (jamais un joueur).', {}),
  tool('combattre', "Te battre contre un joueur (seulement s'il t'a frappé ou si vous êtes d'accord pour un duel).", { joueur: JOUEUR }, ['joueur']),
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
  tool('demander', "Demander un objet ou de l'aide aux autres joueurs dans le chat. quoi = ce que tu veux en clair (quoi, combien, où le donner).", { quoi: { type: 'string', minLength: 1, maxLength: 120 } }, ['quoi']),
  tool('semer', 'Labourer la terre près de toi avec une houe et planter des graines de blé (wheat_seeds).', { nombre: { type: 'integer', minimum: 1, maximum: 9 } }, ['nombre']),
  tool('recolter', 'Récolter le blé mûr de ta ferme et le replanter.', {}),
  tool('enclos', "Construire un enclos de 5x5 (15 barrières et 1 portillon) près de toi. Relance-le pour continuer le chantier.", {}),
  tool('attirer', "Attirer un animal dans ton enclos en tenant sa nourriture (cow et sheep : wheat, pig : carrot, chicken : wheat_seeds).", { animal: { type: 'string', enum: ['cow', 'sheep', 'pig', 'chicken'] } }, ['animal']),
  tool('reproduire', 'Donner à manger à deux animaux pour qu\'un petit naisse.', { animal: { type: 'string', enum: ['cow', 'sheep', 'pig', 'chicken'] } }, ['animal']),
  tool('construire', 'Construire une cabane de 5x5 près de toi (environ 70 blocs : cobblestone ou planches). Relance-la pour continuer le chantier.', {}),
  tool('construire_plan', "Construire une structure que tu inventes (maison, tour...), en pavés de blocs. Coordonnées relatives à toi : x et z de 0 à 30 (est et sud), y = 0 au sol. Les pavés sont posés dans l'ordre, creux = seulement les faces (murs d'une pièce), un pavé air placé après creuse une porte ou des fenêtres. Le plan est gardé : pour refaire une structure déjà faite, donne juste son nom. Relance avec le même nom pour continuer le chantier.", {
    nom: { type: 'string', maxLength: 40 },
    paves: { type: 'array', items: { type: 'object', properties: { bloc: ID_MC, de: { type: 'array', items: COORD }, a: { type: 'array', items: COORD }, creux: { type: 'boolean' } }, required: ['bloc', 'de', 'a'] } },
  }, ['nom']),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Niveau des diamants : on ne creuse pas plus bas (bedrock juste en dessous).
const FOND = -58;

// Un joueur trop loin pour être vu : aller aux coordonnées qu'il a données dans le chat (10 dernières minutes).
async function allerVersCoordonnees(bot, joueur) {
  const p = bot.positionsAnnoncees && bot.positionsAnnoncees[joueur];
  if (!p || Date.now() - p.t > 10 * 60000) throw new Error(`${joueur} est trop loin pour que tu le voies et tu n'as pas ses coordonnées : demande-les-lui`);
  await mindcraft(bot, 'goToGoal', new goals.GoalNearXZ(p.x, p.z, 3));
  if (!bot.players[joueur] || !bot.players[joueur].entity) throw new Error(`tu es allé en ${p.x} ${p.z} mais ${joueur} n'est plus là : demande-lui où il est`);
}
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
  // Test en équipe du 22/10 : 37 dons ratés, la bâtisseuse promettait des objets qu'elle n'avait pas.
  if (name === 'donner' && args.objet && bot.registry && bot.inventory && !bot.inventory.items().some((i) => i.name === nomObjet(bot, args.objet))) {
    errors.push(`tu n'as pas de ${args.objet} : tu ne peux pas le donner, dis-le plutôt dans le chat`);
  }
  // Même test : le mineur, mort, a voulu miner 24 fois de la pierre sans pioche.
  const bloc = name === 'collecter' && args.bloc && bot.registry && bot.registry.blocksByName[nomObjet(bot, args.bloc)];
  if (bloc && bloc.harvestTools && !(bot.game && bot.game.gameMode === 'creative') && !bot.inventory.items().some((i) => bloc.harvestTools[i.type])) {
    errors.push(`il te faut un outil pour miner ${args.bloc} (une pioche au moins en bois) : fabrique-le d'abord`);
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
  async parler(bot, { message }) {
    bot.chat(message);
    return 'message envoyé';
  },

  async murmurer(bot, { joueur, message }) {
    bot.chat(`/msg ${joueur} ${message}`);
    return 'message privé envoyé';
  },

  async aller_vers_joueur(bot, { joueur }) {
    // Trop loin pour être vu : il va aux coordonnées que le joueur a données dans le chat, s'il y en a.
    if (!bot.players[joueur].entity) await allerVersCoordonnees(bot, joueur);
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
    // Il promettait 15 bois 15 fois sans jamais les donner : "Could not find" quand le joueur était trop loin.
    if (!bot.players[joueur].entity) await allerVersCoordonnees(bot, joueur);
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

  // Combat contre un joueur, comme contre un monstre : temps de réaction, coups ratés, rythme irrégulier.
  // Il arrête au bout de 15 s, si le joueur s'éloigne, ou s'il a trop peu de vie (il fuit alors).
  async combattre(bot, { joueur }, { style }) {
    const cible = playerEntity(bot, joueur);
    const arme = bot.inventory.items().find((i) => i.name.endsWith('_sword')) ?? bot.inventory.items().find((i) => i.name.endsWith('_axe'));
    if (arme) await bot.equip(arme, 'hand');
    bot.pathfinder.setGoal(new goals.GoalFollow(cible, 2), true);
    const fin = Date.now() + 15000;
    let coups = 0;
    while (cible.isValid && Date.now() < fin && !bot.interrompre && bot.health > 6) {
      const d = bot.entity.position.distanceTo(cible.position);
      if (d > 16) break;
      if (d < 3.5) {
        frapper(bot, cible, style.rateCoup);
        coups++;
      }
      await sleep(delaiEntreCoups());
    }
    bot.pathfinder.setGoal(null);
    if (bot.health <= 6) throw new Error(`tu as presque plus de vie (${Math.round(bot.health)}), fuis !`);
    return `${coups} coups portés à ${joueur}${cible.isValid ? '' : ', il est mort ou parti'}`;
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
    // On s'arrête au niveau des diamants (y=-58) : en dessous c'est la bedrock, il creusait dedans 70 fois.
    const possible = Math.floor(bot.entity.position.y) - FOND;
    if (possible <= 0) throw new Error(`tu es déjà tout en bas (y=${Math.floor(bot.entity.position.y)}) : mine autour de toi (collecter) au lieu de creuser`);
    return mindcraft(bot, 'digDown', Math.min(blocs, possible));
  },

  // La demande est faite par la parole (agent.js) : ici il n'y a rien à exécuter dans le jeu.
  async demander() {
    return 'demande faite dans le chat';
  },

  async semer(bot, { nombre }) {
    if (!bot.inventory.items().some((i) => i.name.endsWith('_hoe'))) throw new Error('il te faut une houe (fabriquer wooden_hoe)');
    if (!bot.inventory.items().some((i) => i.name === 'wheat_seeds')) throw new Error("il te faut des graines de blé : casse de l'herbe (collecter short_grass)");
    const cases = terreASemer(bot, nombre);
    if (cases.length === 0) throw new Error('pas de terre libre ici pour semer, va un peu plus loin');
    let semees = 0;
    for (const c of cases) {
      if (bot.interrompre) break;
      try {
        await mindcraft(bot, 'tillAndSow', c.x, c.y, c.z, 'wheat_seeds');
        semees++;
        bot.champ = (bot.champ || []).concat([c]);
      } catch { /* case ratée, on passe à la suivante */ }
    }
    if (semees === 0) throw new Error("aucune graine plantée (plus de graines ou terre impossible à labourer)");
    if (bot.champ.length >= 6) bot.fermeFaite = true;
    return `${semees} graines de blé semées (le blé met quelques minutes à pousser)`;
  },

  async recolter(bot) {
    const murs = bleMur(bot);
    if (murs.length === 0) throw new Error("pas de blé mûr pour l'instant, il pousse en quelques minutes : fais autre chose en attendant");
    let recoltes = 0;
    for (const p of murs.slice(0, 9)) {
      if (bot.interrompre) break;
      try {
        await mindcraft(bot, 'breakBlockAt', p.x, p.y, p.z);
        recoltes++;
        await mindcraft(bot, 'tillAndSow', p.x, p.y - 1, p.z, 'wheat_seeds').catch(() => {}); // on replante tout de suite
      } catch { /* bloc raté, on passe au suivant */ }
    }
    await mindcraft(bot, 'pickupNearbyItems').catch(() => {});
    return `${recoltes} blés récoltés et replantés`;
  },

  async enclos(bot) {
    // Le chantier est gardé sur le bot, comme pour la cabane : on reprend là où on s'était arrêté.
    if (!bot.chantierEnclos) {
      const barrieres = bot.inventory.items().filter((i) => i.name.endsWith('_fence')).reduce((s, i) => s + i.count, 0);
      const portillon = bot.inventory.items().some((i) => i.name.endsWith('_fence_gate'));
      if (barrieres < 15 || !portillon) {
        throw new Error(`il te faut 15 barrières et 1 portillon (tu as ${barrieres} barrière(s)${portillon ? '' : ', pas de portillon'}) : fabriquer oak_fence et oak_fence_gate`);
      }
      const origine = trouverTerrain(bot);
      if (!origine) throw new Error("pas d'endroit plat et dégagé de 5x5 ici, va un peu plus loin");
      bot.chantierEnclos = { origine, restants: plansEnclos(origine) };
    }
    const c = bot.chantierEnclos;
    let poses = 0;
    const fin = Date.now() + 45000;
    while (c.restants.length > 0 && Date.now() < fin && !bot.interrompre) {
      const b = c.restants[0];
      if (!vide(bot, b.pos)) {
        c.restants.shift();
        continue;
      }
      const item = bot.inventory.items().find((i) => i.name.endsWith(b.portillon ? '_fence_gate' : '_fence'));
      if (!item) throw new Error("plus assez de barrières ou pas de portillon : fabriquer oak_fence ou oak_fence_gate");
      try {
        await mindcraft(bot, 'placeBlock', item.name, b.pos.x, b.pos.y, b.pos.z);
        poses++;
        c.restants.shift();
      } catch {
        b.essais = (b.essais || 0) + 1;
        c.restants.shift();
        if (b.essais < 3) c.restants.push(b);
      }
    }
    if (c.restants.length === 0) {
      bot.enclos = { origine: c.origine };
      bot.chantierEnclos = null;
      return `enclos fini en ${c.origine.x} ${c.origine.z} : attire des animaux dedans avec leur nourriture (attirer)`;
    }
    return `enclos : ${poses} barrières posées, encore ${c.restants.length} (relance enclos)`;
  },

  async attirer(bot, { animal }) {
    if (!bot.enclos) throw new Error("fais d'abord un enclos (enclos)");
    const appat = bot.inventory.items().find((i) => NOURRITURE_ANIMAL[animal].includes(i.name));
    if (!appat) throw new Error(`il te faut ${NOURRITURE_ANIMAL[animal][0]} en main pour attirer un ${animal}`);
    const bete = bot.nearestEntity((e) => e.name === animal && !dansEnclos(bot.enclos, e.position) && e.position.distanceTo(bot.entity.position) < 48);
    if (!bete) throw new Error(`aucun ${animal} hors de l'enclos à moins de 48 blocs, explore pour en trouver`);
    await bot.equip(appat, 'hand');
    // On marche (sans courir) pour que l'animal suive, et on ne casse rien en chemin.
    const avant = bot.pathfinder.movements;
    const lent = new Movements(bot);
    lent.allowSprinting = false;
    lent.canDig = false;
    bot.pathfinder.setMovements(lent);
    const o = bot.enclos.origine;
    const ouvrirPortillon = async (ouvert) => {
      const portillon = bot.blockAt(o.offset(2, 0, 0));
      if (portillon && portillon.name.endsWith('_fence_gate') && portillon.getProperties().open !== ouvert) await bot.activateBlock(portillon);
    };
    try {
      await allerAvecLimite(bot, new goals.GoalFollow(bete, 3), 30000); // aller chercher l'animal
      await allerAvecLimite(bot, new goals.GoalNear(o.x + 2, o.y, o.z - 1, 1), 40000); // revenir devant le portillon
      await ouvrirPortillon(true);
      await allerAvecLimite(bot, new goals.GoalNear(o.x + 2, o.y, o.z + 2, 0), 15000); // entrer au centre
      await sleep(3000); // laisser l'animal entrer derrière lui
      await allerAvecLimite(bot, new goals.GoalNear(o.x + 2, o.y, o.z - 1, 0), 15000); // ressortir
      await ouvrirPortillon(false);
    } finally {
      bot.pathfinder.setMovements(avant);
    }
    const dedans = Object.values(bot.entities).filter((e) => NOURRITURE_ANIMAL[e.name] && dansEnclos(bot.enclos, e.position));
    bot.animauxEnclos = dedans.length;
    return `${dedans.filter((e) => e.name === animal).length} ${animal} dans l'enclos (${dedans.length} animaux en tout)`;
  },

  async reproduire(bot, { animal }) {
    const appat = bot.inventory.items().find((i) => NOURRITURE_ANIMAL[animal].includes(i.name));
    if (!appat || appat.count < 2) throw new Error(`il te faut 2 ${NOURRITURE_ANIMAL[animal][0]} pour les faire se reproduire`);
    const betes = Object.values(bot.entities)
      .filter((e) => e.name === animal && e.position.distanceTo(bot.entity.position) < 12).slice(0, 2);
    if (betes.length < 2) throw new Error(`il faut 2 ${animal} près de toi`);
    await bot.equip(appat, 'hand');
    for (const b of betes) {
      await allerAvecLimite(bot, new goals.GoalFollow(b, 2), 15000);
      await bot.activateEntity(b);
      await sleep(500);
    }
    return `deux ${animal} nourris : un petit devrait naître`;
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

  async construire_plan(bot, { nom, paves }) {
    // Test du 22/10 : Joueur5 relançait sans fin la même structure finie, à chaque fois un peu plus loin.
    bot.structuresFinies = bot.structuresFinies || [];
    if (bot.structuresFinies.includes(nom) && !(paves && paves.length)) throw new Error(`tu as déjà fini ${nom} : fais autre chose`);
    const c0 = bot.chantierPlan;
    if (!c0 || c0.nom !== nom || (paves && paves.length)) {
      const plan = paves && paves.length ? paves : chargerStructure(nom);
      if (!plan) throw new Error(`aucune structure "${nom}" enregistrée : donne ses pavés`);
      const origine = bot.entity.position.floored().offset(2, 0, 2);
      const restants = plansStructure(origine, plan);
      const inconnus = [...new Set(restants.map((r) => r.bloc))].filter((n) => !bot.registry.itemsByName[nomObjet(bot, n)]);
      if (inconnus.length) throw new Error(`blocs inconnus : ${inconnus.join(', ')} (identifiants Minecraft anglais, ex. oak_planks)`);
      bot.chantierPlan = { nom, origine, restants };
      if (paves && paves.length) sauverStructure(nom, paves, bot.username);
    }
    const c = bot.chantierPlan;
    const creatif = bot.game.gameMode === 'creative';
    let poses = 0;
    const fin = Date.now() + 40000; // on rend la main avant la limite de 60 s d'une action (8 s au plus par bloc)
    while (c.restants.length > 0 && Date.now() < fin && !bot.interrompre) {
      const b = c.restants[0];
      c.restants.shift();
      if (!vide(bot, b.pos)) continue;
      const bloc = nomObjet(bot, b.bloc);
      if (!creatif && !bot.inventory.items().some((i) => i.name === bloc)) throw new Error(`il te manque du ${b.bloc}, encore ${c.restants.length + 1} blocs à poser`);
      try {
        // En créatif, il vole au-dessus du bloc à poser (les couches du dessus ne sont pas encore posées).
        if (creatif && bot.entity.position.distanceTo(b.pos) > 4) await bot.creative.flyTo(b.pos.offset(0.5, 2, 0.5));
        // Un bloc qui bloque (chemin introuvable) ne doit pas faire couper toute l'action à 60 s.
        await Promise.race([mindcraft(bot, 'placeBlock', bloc, b.pos.x, b.pos.y, b.pos.z), sleep(8000).then(() => { throw new Error('trop long'); })]);
        poses++;
      } catch {
        bot.pathfinder.stop();
        b.essais = (b.essais || 0) + 1;
        if (b.essais < 3) c.restants.push(b);
        else c.rates = (c.rates || 0) + 1;
      }
    }
    if (creatif) bot.creative.stopFlying(); // sinon il reste en l'air pour l'action suivante
    const o = c.origine;
    if (c.restants.length > 0) return `${nom} en ${o.x} ${o.z} : ${poses} blocs posés, encore ${c.restants.length} (relance construire_plan avec le même nom)`;
    bot.chantierPlan = null;
    bot.structuresFinies.push(nom);
    if (c.rates) return `${nom} terminé en ${o.x} ${o.z}, mais ${c.rates} blocs n'ont pas pu être posés`;
    return `${nom} fini en ${o.x} ${o.z} (${poses} blocs posés cette fois)`;
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
      try {
        await mindcraft(bot, 'goToGoal', new goals.GoalY(Math.min(surface, Math.floor(avant) + 30)));
      } catch {
        // Pas de chemin (au fond d'un puits de 1 x 1, 48 échecs) : il monte en pilier, bloc par bloc.
        await executors.monter(bot, { blocs: 10 });
      }
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

const aUnItem = (bot, fin) => bot.inventory.items().some((i) => i.name.endsWith(fin));

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
  const joueurProche = Object.values(bot.players).some((p) => p.username !== bot.username && p.entity && pos.distanceTo(p.entity.position) < 16);
  return TOOLS.filter((t) => !(
    (!aManger && t.name === 'manger')
    || (!animal && t.name === 'chasser')
    || (!blocs && t.name === 'construire')
    || (!joueurProche && t.name === 'combattre')
    || (!aUnItem(bot, '_hoe') && t.name === 'semer')
    || (!bot.champ && t.name === 'recolter')
    || (!bot.chantierEnclos && !aUnItem(bot, '_fence') && t.name === 'enclos')
    || (!bot.enclos && (t.name === 'attirer' || t.name === 'reproduire'))
    || (!autres && OUTILS_JOUEURS.includes(t.name))
    || (!coffre && OUTILS_COFFRE.includes(t.name))
    || (!monstre && OUTILS_COMBAT.includes(t.name))
    || (!nuit && t.name === 'dormir')
    || (pos.y >= 50 && t.name === 'remonter')
  ));
}


// Outil de la réflexion (agent.js, reflechir) : toutes les quelques minutes, il fait le point.
const TEXTE = (n) => ({ type: 'string', maxLength: n });
// Outil de la parole (agent.js, parler) : les deux champs sont obligatoires, sinon le modèle "oubliait" de répondre.
// engagement = ce qu'il promet de faire tout de suite : le cerveau des actions le fera (cohérence parole/actions).
const OUTIL_PAROLE = {
  name: 'repondre',
  description: 'Ta réaction dans le chat.',
  parameters: {
    type: 'object',
    properties: {
      repond_a: { type: 'string', maxLength: 200 },
      dire: { type: 'string', maxLength: 200 },
      engagement: { type: 'string', maxLength: 150 },
      pensee: { type: 'string', maxLength: 300 },
      note: { type: 'string', maxLength: 150 },
      promesse: { type: 'string', maxLength: 150 },
    },
    required: ['repond_a', 'dire', 'engagement'],
  },
};

const OUTIL_REFLEXION = {
  name: 'reflexion',
  description: 'Faire le point sur la partie.',
  parameters: {
    type: 'object',
    properties: {
      resume: TEXTE(800),
      avis: { type: 'array', items: { type: 'object', properties: { joueur: TEXTE(32), avis: TEXTE(120) } } },
      intention: TEXTE(400),
      nouvel_objectif: TEXTE(64),
      nombre: { type: 'integer', minimum: 1, maximum: 64 },
    },
    required: ['resume', 'intention'],
  },
};

module.exports = { TOOLS, executors, execute, checkArgs, nomObjet, outilsUtiles, OUTIL_REFLEXION, OUTIL_PAROLE };
