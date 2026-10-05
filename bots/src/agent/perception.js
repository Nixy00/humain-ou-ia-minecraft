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
    `Toi : ${bot.username}. Vie ${round(bot.health)}/20, faim ${round(bot.food)}/20. Position x=${round(me.x)} y=${round(me.y)} z=${round(me.z)}. Il fait ${moment}.`,
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
  if (moment === 'nuit') situation.push("c'est la nuit, les monstres sortent : reste à l'abri ou près des autres, ne pars pas loin");
  if (bot.health <= 8) situation.push('tu as peu de vie : évite les monstres et mange si tu peux');
  if (bot.food <= 8 && !aManger) situation.push("tu as faim et rien à manger : cherche à manger (animaux, pommes, demander à quelqu'un)");
  if (situation.length > 0) lines.push(`Attention : ${situation.join(' ; ')}.`);

  // Bon sens de joueur (pas de "speedrun") : il accumulait 60 bûches sans jamais faire d'outil.
  const nb = (fin) => bot.inventory.items().filter((i) => i.name.endsWith(fin)).reduce((s, i) => s + i.count, 0);
  const idees = [];
  // Une idée précise marche mieux avec ce modèle qu'un conseil vague (il avait tout pour une pioche et ne l'a pas faite).
  // Pioche en bois = 3 planches + 2 bâtons + une table (dans l'inventaire, ou 4 planches de plus pour la fabriquer).
  const aUneTable = nb('crafting_table') > 0;
  if (nb('_pickaxe') === 0 && nb('stick') >= 2 && nb('_planks') >= (aUneTable ? 3 : 7)) {
    idees.push(aUneTable
      ? 'tu as tout pour une pioche : fabriquer wooden_pickaxe (ta table de craft sera posée toute seule)'
      : 'tu as tout pour une pioche : fabriquer crafting_table puis wooden_pickaxe');
  } else if (nb('_log') + nb('_planks') >= 3 && nb('_pickaxe') === 0) {
    idees.push('tu as du bois : tu peux faire des planches, une table de craft puis une pioche');
  }
  if (nb('_log') >= 32) idees.push('tu as déjà beaucoup de bois, fais autre chose avec');
  if (bot.food <= 14 && !aManger) {
    idees.push(animaux.length > 0
      ? `tu as faim et il y a un animal en vue (${animaux[0]}) : chasser`
      : "tu as faim et rien à manger, aucun animal en vue : explorer pour en trouver (ils sont souvent en bas, dans les plaines)");
  }
  if (idees.length > 0) lines.push(`Idées : ${idees.join(' ; ')}.`);
  if (memory.objectif) lines.push(`Ton objectif noté : ${memory.objectif}`);
  const demandes = memory.demandes.filter((d) => Date.now() - d.t < 10 * 60000);
  if (demandes.length > 0) {
    lines.push('', "Ce qu'on t'a demandé récemment (fais-le, ou dis simplement que tu ne peux pas) :");
    for (const d of demandes) lines.push(`- [${agoText(d.t)}] <${d.from}> ${d.text}`);
  }
  if (memory.notes.length > 0) {
    lines.push('', 'Ton carnet (ce que tu as noté pour t\'en souvenir) :');
    for (const n of memory.notes) lines.push(`- [${agoText(n.t)}] ${n.text}`);
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
  for (const e of memory.events) lines.push(`- [${e.type}, ${agoText(e.t)}] ${e.text}`);

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
