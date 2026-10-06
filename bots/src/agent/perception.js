// Perception : transforme l'état du jeu vu par le client en un texte court pour le modèle.
// L'agent ne voit que ce qu'un joueur humain voit (son client) : aucune donnée serveur privilégiée.

const INTERESTING_BLOCK = /(_log|_ore|_bed|^stone|^cobblestone|^crafting_table|^furnace|^chest|^sand|^gravel|^clay|^wheat|^sugar_cane|^pumpkin|^melon)$/;

// Animaux que l'on peut chasser pour manger.
const ANIMAUX = ['cow', 'pig', 'chicken', 'sheep', 'rabbit'];

function isHostile(e) {
  return e.type === 'hostile' || e.kind === 'Hostile mobs';
}

function round(n) {
  return Math.round(n);
}

function agoText(t) {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `il y a ${s} s` : `il y a ${Math.round(s / 60)} min`;
}

function inventorySummary(bot) {
  const counts = {};
  for (const it of bot.inventory.items()) counts[it.name] = (counts[it.name] ?? 0) + it.count;
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([n, c]) => `${n} x${c}`).join(', ') : 'vide';
}

function nearbyBlocks(bot, mcData, radius = 16) {
  if (!nearbyBlocks.ids) {
    nearbyBlocks.ids = mcData.blocksArray.filter((b) => INTERESTING_BLOCK.test(b.name)).map((b) => b.id);
  }
  const positions = bot.findBlocks({ matching: nearbyBlocks.ids, maxDistance: radius, count: 200 });
  const groups = {};
  for (const pos of positions) {
    const name = bot.blockAt(pos)?.name;
    if (!name) continue;
    const d = bot.entity.position.distanceTo(pos);
    const g = (groups[name] ??= { count: 0, nearest: Infinity });
    g.count++;
    g.nearest = Math.min(g.nearest, d);
  }
  const entries = Object.entries(groups).sort((a, b) => a[1].nearest - b[1].nearest);
  return entries.length ? entries.map(([n, g]) => `${n} (${g.count}, le plus proche à ${round(g.nearest)} blocs)`).join(', ') : 'rien de notable';
}

// Objets utiles qu'on vérifie (tous les objets du jeu, c'est 1 300 recettes à chaque décision et beaucoup de bruit).
const A_FABRIQUER = ['crafting_table', 'stick', 'torch', 'furnace', 'chest', 'white_bed', 'bucket', 'shield', 'ladder', 'oak_door',
  'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'wooden_axe', 'stone_axe', 'iron_axe',
  'wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword', 'stone_shovel', 'iron_shovel',
  'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots',
  'iron_block', 'diamond_block', 'bread'];

// Ce qu'il peut fabriquer tout de suite : il devinait les recettes et 39 % de ses "fabriquer" échouaient.
function fabricables(bot) {
  const table = bot.inventory.items().some((i) => i.name === 'crafting_table')
    || Boolean(bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 16 }));
  const noms = [...A_FABRIQUER];
  for (const i of bot.inventory.items()) if (i.name.endsWith('_log') && !i.name.startsWith('stripped')) noms.push(i.name.replace('_log', '_planks'));
  return [...new Set(noms)].filter((nom) => {
    const item = bot.registry.itemsByName[nom];
    // Sans table, recipesFor renvoie aussi les recettes qui en demandent une : on les enlève.
    return item && bot.recipesFor(item.id, null, 1, table || null).some((r) => table || !r.requiresTable);
  });
}

function observe(bot, mcData, memory) {
  const me = bot.entity.position;
  const others = Object.values(bot.players).filter((p) => p.username !== bot.username);
  const visible = others
    .filter((p) => p.entity)
    .map((p) => {
      // Le modèle lisait mal "à 2 blocs" et disait "je te vois pas" : on l'écrit clairement.
      const d = round(me.distanceTo(p.entity.position));
      return d <= 8 ? `${p.username} juste à côté de toi (${d} blocs, tu le vois)` : `${p.username} à ${d} blocs (tu le vois)`;
    });
  const hostiles = Object.values(bot.entities)
    .filter((e) => isHostile(e) && me.distanceTo(e.position) < 16)
    .map((e) => `${e.name} à ${round(me.distanceTo(e.position))} blocs`);
  // Le serveur n'envoie les animaux qu'à moins de 48 blocs : au-delà, on ne les voit pas (comme un humain).
  const animaux = Object.values(bot.entities)
    .filter((e) => ANIMAUX.includes(e.name) && me.distanceTo(e.position) < 48)
    .map((e) => `${e.name} à ${round(me.distanceTo(e.position))} blocs`)
    .slice(0, 5);
  const tod = bot.time?.timeOfDay ?? 0;
  const moment = tod < 12300 || tod > 23850 ? 'jour' : 'nuit';

  const lines = [
    `Toi : ${bot.username}. Vie ${round(bot.health)}/20, faim ${round(bot.food)}/20. Position x=${round(me.x)} y=${round(me.y)} z=${round(me.z)}${me.y < 50 ? ' (sous terre, loin de la surface)' : ''}. Il fait ${moment}.`,
    `Inventaire : ${inventorySummary(bot)}.`,
    `Joueurs connectés : ${others.map((p) => p.username).join(', ') || 'aucun'}.`,
    `Joueurs visibles : ${visible.join(', ') || 'aucun'}.`,
    `Monstres proches : ${hostiles.join(', ') || 'aucun'}.`,
    `Animaux en vue : ${animaux.join(', ') || 'aucun'}.`,
    `Blocs utiles autour : ${nearbyBlocks(bot, mcData)}.`,
  ];
  // Ce qu'un joueur normal remarquerait sur sa situation (seulement quand c'est utile).
  const aManger = bot.inventory.items().some((i) => bot.registry && bot.registry.foodsByName && bot.registry.foodsByName[i.name]);
  const situation = [];
  // Avant : "reste à l'abri" et il attendait 8 minutes sans rien faire. Un joueur continue à miner ou crafter.
  if (moment === 'nuit') situation.push("c'est la nuit, les monstres sortent : ne pars pas loin, mais continue à miner, couper ou fabriquer près de toi");
  if (bot.health <= 8) situation.push('tu as peu de vie : évite les monstres et mange si tu peux');
  if (bot.food <= 8 && !aManger) situation.push("tu as faim et rien à manger : cherche à manger (animaux, pommes, demander à quelqu'un)");
  if (situation.length > 0) lines.push(`Attention : ${situation.join(' ; ')}.`);

  // Bon sens de joueur (pas de "speedrun") : il accumulait 60 bûches sans jamais faire d'outil.
  const nb = (fin) => bot.inventory.items().filter((i) => i.name.endsWith(fin)).reduce((s, i) => s + i.count, 0);
  const idees = [];
  // Une idée précise marche mieux avec ce modèle qu'un conseil vague (il avait tout pour une pioche et ne l'a pas faite).
  // Pioche en bois = 3 planches + 2 bâtons + une table (dans l'inventaire, ou 4 planches de plus pour la fabriquer).
  const aUneTable = nb('crafting_table') > 0;
  if (nb('_pickaxe') === 0 && nb('cobblestone') < 3 && nb('stick') >= 2 && nb('_planks') >= (aUneTable ? 3 : 7)) {
    idees.push(aUneTable
      ? 'tu as tout pour une pioche : fabriquer wooden_pickaxe (ta table de craft sera posée toute seule)'
      : 'tu as tout pour une pioche : fabriquer crafting_table puis wooden_pickaxe');
  } else if (nb('_log') + nb('_planks') >= 3 && nb('_pickaxe') === 0) {
    idees.push('tu as du bois : tu peux faire des planches, une table de craft puis une pioche');
  }
  // Sa pioche en bois s'est cassée et il a réessayé de miner la pierre 7 fois au lieu d'en refaire une.
  const aPiocheMieux = ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'].some((p) => nb(p) > 0);
  if (!aPiocheMieux && nb('cobblestone') >= 3 && (nb('stick') >= 2 || nb('_planks') >= 2)) {
    idees.push(nb('_pickaxe') === 0
      ? "tu n'as plus de pioche : fabriquer stone_pickaxe (3 cobblestone + 2 stick)"
      : 'tu as de la cobblestone : fabriquer stone_pickaxe, elle mine le fer');
  }
  if (nb('_log') >= 32) idees.push('tu as déjà beaucoup de bois, fais autre chose avec');
  if (bot.food <= 14 && !aManger) {
    idees.push(animaux.length > 0
      ? `tu as faim et il y a un animal en vue (${animaux[0]}) : chasser`
      : "tu as faim et rien à manger, aucun animal en vue : explorer pour en trouver (ils sont souvent en bas, dans les plaines)");
  }
  if (idees.length > 0) lines.push(`Idées : ${idees.join(' ; ')}.`);
  if (bot.recipesFor) {
    const f = fabricables(bot);
    lines.push(`Tu peux fabriquer maintenant : ${f.length ? f.join(', ') : "rien d'utile"}.`);
  }
  if (memory.envie) lines.push(`Ce que tu as envie de faire dans cette partie : ${memory.envie}`);
  if (memory.mission) lines.push(`Ta mission : ${memory.mission}`);
  // Toujours affichée : c'est le bot qui choisit entre son étape et une demande (selon son caractère).
  if (memory.etape) lines.push(`Prochaine étape pour avancer (calculée pour toi) : ${memory.etape}`);
  const demandes = memory.demandes.filter((d) => Date.now() - d.t < 10 * 60000);
  if (demandes.length > 0) {
    lines.push('', "Ce qu'on t'a demandé récemment (à toi de voir selon ton caractère et ce que tu fais : maintenant, plus tard ou non) :");
    for (const d of demandes) lines.push(`- [${agoText(d.t)}] <${d.from}> ${d.text}${d.info || ''}`);
  }
  const promesses = (memory.promesses || []).filter((p) => Date.now() - p.t < 20 * 60000);
  if (promesses.length > 0) {
    lines.push('', "Tes promesses (quand ton truc est fini, tiens-les ou demande s'il a toujours besoin) :");
    for (const p of promesses) lines.push(`- [${agoText(p.t)}] ${p.text}`);
  }
  if (memory.notes.length > 0) {
    lines.push('', 'Ton carnet (ce que tu as noté pour t\'en souvenir) :');
    // Il notait souvent deux fois la même chose : on n'affiche que la dernière.
    const notes = memory.notes.filter((n, i) => !memory.notes.slice(i + 1).some((m) => m.text === n.text));
    for (const n of notes) lines.push(`- [${agoText(n.t)}] ${n.text}`);
  }

  // Le chat est affiché comme une vraie conversation : les messages des autres et les tiens, dans l'ordre.
  lines.push('', 'Conversation dans le chat (du plus ancien au plus récent, <toi> = tes messages) :');
  if (memory.chat.length === 0) lines.push('- personne n\'a encore parlé');
  for (const m of memory.chat) {
    const qui = m.from === bot.username ? 'toi' : m.from;
    let prive = '';
    if (m.type === 'whisper') prive = m.from === bot.username ? ` (en privé à ${m.to})` : ' (en privé)';
    lines.push(`- [${agoText(m.t)}] <${qui}>${prive} ${m.text}`);
  }

  lines.push('', 'Autres évènements récents :');
  if (memory.events.length === 0) lines.push('- aucun');
  // Évènements identiques à la suite regroupés : la fuite devant un squelette apparaissait 12 fois.
  const groupes = [];
  for (const e of memory.events) {
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier.type === e.type && dernier.text === e.text) {
      dernier.fois++;
      dernier.t = e.t;
    } else groupes.push({ ...e, fois: 1 });
  }
  for (const e of groupes) lines.push(`- [${e.type}, ${agoText(e.t)}] ${e.text}${e.fois > 1 ? ` (x${e.fois})` : ''}`);

  // Les messages sont déjà dans la conversation, on ne les répète pas ici.
  const actions = memory.actions.filter((a) => a.name !== 'parler' && a.name !== 'murmurer');
  lines.push('', 'Tes dernières actions dans le jeu :');
  if (actions.length === 0) lines.push('- aucune');
  for (const a of actions) {
    lines.push(`- ${a.name} ${JSON.stringify(a.args)} -> ${a.ok ? 'réussi' : 'échec'} : ${a.result} (${agoText(a.t)})`);
  }
  return lines.join('\n');
}

module.exports = { observe, isHostile, ANIMAUX };
