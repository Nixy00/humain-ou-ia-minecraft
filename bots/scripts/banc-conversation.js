// Banc d'essai de la conversation : des situations de chat écrites à l'avance, passées à la vraie parole
// du bot (agent.js) avec le vrai modèle, SANS lancer Minecraft. On lit ce que le bot répond et fait.
// Utilisation : node scripts/banc-conversation.js [nombre d'essais par situation, 2 par défaut]
const { Vec3 } = require('vec3');
const cfg = require('../src/config');
const { Gateway } = require('../src/llm/gateway');
const { Agent } = require('../src/agent/agent');

const ESSAIS = parseInt(process.argv[2], 10) || 2;
const profils = require('../agents.json');
const registry = require('minecraft-data')('1.20.4');
const il = (s) => Date.now() - s * 1000; // "il y a s secondes"

// Chaque situation : le bot, son inventaire, l'action en cours, le chat récent et ce qui le réveille.
const SITUATIONS = [
  { nom: 'on lui demande de la pierre', bot: 'Joueur4', inventaire: { cobblestone: 40, stone_pickaxe: 1 }, enCours: 'collecter',
    chat: [['Joueur6', 'joueur4 tas de la pierre ?', 5]], raison: 'message de Joueur6 : "joueur4 tas de la pierre ?"' },
  { nom: 'on le soupçonne d\'être un bot', bot: 'Joueur5', inventaire: { iron_sword: 1 }, enCours: 'collecter',
    chat: [['SAHYGO', 'joueur5 tes un bot ou quoi', 4]], raison: 'message de SAHYGO : "joueur5 tes un bot ou quoi"' },
  { nom: 'salut à tout le monde', bot: 'Joueur6', inventaire: { oak_planks: 20 }, enCours: 'construire',
    chat: [['SAHYGO', 'yo les gars ca va ?', 3]], raison: 'message de SAHYGO à tout le monde : "yo les gars ca va ?"' },
  { nom: 'sujet hors jeu : la meteo', bot: 'Joueur4', inventaire: { cobblestone: 12 }, enCours: 'collecter',
    chat: [['SAHYGO', 'joueur4 il pleut chez toi ? ici cest le deluge', 4]], raison: "SAHYGO vient d'écrire : « joueur4 il pleut chez toi ? ici cest le deluge »" },
  { nom: 'sujet hors jeu : un film', bot: 'Joueur6', inventaire: { oak_planks: 10 }, enCours: 'construire',
    chat: [['SAHYGO', 'joueur6 tas vu un film recemment ?', 4]], raison: "SAHYGO vient d'écrire : « joueur6 tas vu un film recemment ? »" },
  { nom: "tu viens d'ou", bot: 'Joueur5', inventaire: { iron_sword: 1 }, enCours: 'collecter',
    chat: [['SAHYGO', 'vous venez dou les gars ?', 3]], raison: 'SAHYGO a écrit à tout le monde : "vous venez dou les gars ?"' },
  { nom: 'question à tout le monde, il a la réponse', bot: 'Joueur4', inventaire: { raw_iron: 6, stone_pickaxe: 1 }, enCours: 'collecter',
    chat: [['SAHYGO', 'qqun a trouve du fer ?', 12], ['Joueur5', 'nan', 6]], raison: 'message de SAHYGO à tout le monde : "qqun a trouve du fer ?"' },
  { nom: 'il se fait chambrer', bot: 'Joueur4', inventaire: { stone_axe: 1 }, enCours: 'collecter',
    chat: [['Joueur5', 'joueur4 tes nul tas meme pas de fer mdr', 4]], raison: 'message de Joueur5 : "joueur4 tes nul tas meme pas de fer mdr"' },
  { nom: 'suite d\'une discussion', bot: 'Joueur5', inventaire: { iron_sword: 1, raw_iron: 3 }, enCours: 'creuser',
    chat: [['Joueur5', 'jai trouve une grotte', 40], ['SAHYGO', 'elle est ou ?', 20], ['SAHYGO', 'joueur5 ?', 3]],
    raison: 'message de SAHYGO : "joueur5 ?"' },
  { nom: 'un joueur arrive près de lui', bot: 'Joueur6', inventaire: { oak_planks: 10 }, enCours: 'construire',
    chat: [], raison: 'SAHYGO arrive près de toi', voit: 'SAHYGO' },
];

function fauxBot(nom, s, chat) {
  const items = Object.entries(s.inventaire).map(([name, count]) => ({ name, count }));
  const players = { [nom]: {}, SAHYGO: {}, Joueur4: {}, Joueur5: {}, Joueur6: {} };
  if (s.voit) players[s.voit] = { username: s.voit, entity: { position: new Vec3(5, 64, 0), height: 1.8 } };
  return {
    username: nom, entity: { position: new Vec3(0, 64, 0) }, players, entities: {}, health: 20, food: 18,
    inventory: { items: () => items, emptySlotCount: () => 20 }, findBlocks: () => [], findBlock: () => null, nearestEntity: () => null,
    time: { timeOfDay: 3000 }, registry, pathfinder: { setGoal() {} }, recipesFor: () => [], chat: (m) => chat.push(m),
  };
}

async function main() {
  const gateway = new Gateway(cfg.llm);
  for (const s of SITUATIONS) {
    console.log(`\n=== ${s.nom} (${s.bot})`);
    for (const [from, text, ilYa] of s.chat) console.log(`   <${from}> ${text}`);
    for (let e = 0; e < ESSAIS; e++) {
      const envoyes = [];
      const decisions = [];
      const logger = { gameId: 'banc', write: (type, d) => { if (type === 'decisions') decisions.push(d); } };
      const profil = profils.find((p) => p.username === s.bot);
      const a = new Agent(profil, { cfg: { ...cfg, agent: { ...cfg.agent, humanize: false, mission: '' }, game: { ...cfg.game, agents: ['Joueur4', 'Joueur5', 'Joueur6'] } }, gateway, logger });
      a.mcData = registry;
      a.bot = fauxBot(s.bot, s, envoyes);
      a.lancerAction = () => {};
      a.actionEnCours = s.enCours;
      a.debutAction = Date.now() - 8000;
      a.actionFin = Promise.resolve();
      a.memory.chat = s.chat.map(([from, text, ilYa]) => ({ type: 'chat', from, text, t: il(ilYa) }));
      a.schedule = () => {}; // on ne lance pas le cerveau des actions ici
      await a.parler(s.raison);
      const d = decisions[0] || {};
      console.log(`   -> ${envoyes.length ? `dit : "${envoyes.join(' / ')}"` : 'ne dit rien'}${d.engagement ? ` | s'engage à : ${d.engagement}` : ''}`);
      if (d.pensee) console.log(`      pense : ${d.pensee}`);
    }
  }
}

main();
