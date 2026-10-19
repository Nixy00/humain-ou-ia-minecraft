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
  { nom: 'promesse impossible (donner a raté)', bot: 'Joueur4', inventaire: { oak_log: 15 }, enCours: 'collecter',
    historique: [['donner', false, 'Could not find DrAlphaCheat.'], ['donner', false, 'DrAlphaCheat est trop loin pour que tu le voies et tu n as pas ses coordonnées']],
    chat: [['DrAlphaCheat', 'les 15 de bois je veux bien stp', 120], ['Joueur4', 'je viens te donner les 15 bois tqt', 100], ['DrAlphaCheat', 'tes ou joueur4 ?', 3]],
    raison: "DrAlphaCheat vient d'écrire : « tes ou joueur4 ? »" },
  { nom: 'insulte grave', bot: 'Joueur4', inventaire: { oak_log: 3 }, enCours: 'collecter',
    chat: [['SAHYGO', 'oe ca dit quoi les reuf', 20], ['SAHYGO', 'tg sale noir', 3]], raison: "SAHYGO a écrit à tout le monde : « tg sale noir »" },
  { nom: 'un joueur arrive près de lui', bot: 'Joueur6', inventaire: { oak_planks: 10 }, enCours: 'construire',
    chat: [], raison: 'SAHYGO arrive près de toi', voit: 'SAHYGO' },
  // --- Répondre au bon message (partie du 19/10 : il ramenait tout à sa promesse de 15 bois) ---
  { nom: 'frappé par erreur, on lui demande pourquoi', bot: 'Joueur4', inventaire: { oak_log: 4 }, enCours: 'collecter', engagement: 'donner 15 oak_log à DrAlphaCheat', historique: [['donner', false, 'Could not find DrAlphaCheat.']],
    chat: [['DrAlphaCheat', 'les 15 bois stp', 120], ['Joueur6', 'joueur4 pourquoi tu mas tape ?', 3]], raison: "Joueur6 vient d'écrire : « joueur4 pourquoi tu mas tape ? »",
    attendu: "il répond au sujet du coup (excuse, explication, s'énerve...), pas de son bois" },
  { nom: "quelqu'un a faim", bot: 'Joueur4', inventaire: { oak_log: 4, cooked_beef: 3 }, enCours: 'collecter', engagement: 'donner 15 oak_log à DrAlphaCheat', historique: [['donner', false, 'Could not find DrAlphaCheat.']],
    chat: [['DrAlphaCheat', 'les 15 bois stp', 120], ['Joueur5', 'joueur4 jai pas de bouffe', 3]], raison: "Joueur5 vient d'écrire : « joueur4 jai pas de bouffe »",
    attendu: 'il parle de nourriture (il a 3 boeufs cuits : il peut en proposer), pas de son bois' },
  { nom: 'un autre joueur arrive', bot: 'Joueur4', inventaire: { oak_log: 4 }, enCours: 'collecter', engagement: 'donner 15 oak_log à DrAlphaCheat', historique: [['donner', false, 'Could not find DrAlphaCheat.']],
    chat: [['DrAlphaCheat', 'les 15 bois stp', 120]], raison: 'SAHYGO arrive près de toi (6 blocs)', voit: 'SAHYGO',
    attendu: "il salue SAHYGO ou ne dit rien, sans parler du bois de DrAlphaCheat" },
  { nom: "on lui dit qu'on n'a plus besoin", bot: 'Joueur4', inventaire: { oak_log: 4 }, enCours: 'collecter', engagement: 'donner 15 oak_log à DrAlphaCheat', historique: [['donner', false, 'Could not find DrAlphaCheat.']],
    chat: [['DrAlphaCheat', 'les 15 bois stp', 120], ['DrAlphaCheat', 'cest bon joueur4 jai trouve du bois tout seul', 3]],
    raison: "DrAlphaCheat vient d'écrire : « cest bon joueur4 jai trouve du bois tout seul »",
    attendu: "il prend acte (ok, tant mieux), et ne promet plus de bois" },
  { nom: 'question simple sur ce quil fait', bot: 'Joueur6', inventaire: { oak_planks: 12 }, enCours: 'construire',
    chat: [['SAHYGO', 'joueur6 tu fais quoi la ?', 3]], raison: "SAHYGO vient d'écrire : « joueur6 tu fais quoi la ? »",
    attendu: 'elle dit ce qu\'elle fait (la cabane)' },
];

// Juge automatique : le même modèle dit si la réponse est en rapport avec le message (température 0).
async function juger(gateway, s, reponse) {
  if (!s.attendu) return null;
  const consigne = `Situation : ${s.raison}. Ce qu'on attend : ${s.attendu}. Réponse du joueur : "${reponse || '(il ne dit rien)'}".
Explique d'abord en une phrase si la réponse correspond, puis termine par une dernière ligne : VERDICT: OUI ou VERDICT: NON.`;
  const r = await gateway.chat({ messages: [{ role: 'user', content: consigne }], temperature: 0, max_tokens: 3000, reasoning_effort: 'high' });
  const texte = String(r.message.content || '').trim();
  const verdict = /VERDICT\s*:\s*OUI/i.test(texte) ? 'OUI' : 'NON';
  return `${verdict} (${texte.split('\n')[0].slice(0, 120)})`;
}

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
  let total = 0;
  let bons = 0;
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
      const de = (s.raison.match(/^(\w+) (vient|a écrit|arrive|t'a)/) || [])[1] || null;
      a.actionEnCours = s.enCours;
      a.debutAction = Date.now() - 8000;
      a.actionFin = Promise.resolve();
      a.memory.chat = s.chat.map(([from, text, ilYa]) => ({ type: 'chat', from, text, t: il(ilYa) }));
      a.memory.historique = (s.historique || []).map(([name, ok, result]) => ({ name, args: {}, ok, result, t: il(30) }));
      if (s.engagement) a.memory.engagement = { text: s.engagement, t: il(100) };
      a.schedule = () => {}; // on ne lance pas le cerveau des actions ici
      await a.parler(s.raison, de);
      const d = decisions[0] || {};
      console.log(`   -> ${envoyes.length ? `dit : "${envoyes.join(' / ')}"` : 'ne dit rien'}${d.engagement ? ` | s'engage à : ${d.engagement}` : ''}`);
      const avis = await juger(gateway, s, envoyes.join(' / '));
      if (avis) {
        console.log(`      juge : ${avis}`);
        total++;
        if (/^oui/i.test(avis)) bons++;
      }
      if (d.pensee) console.log(`      pense : ${d.pensee}`);
    }
  }
  console.log(`\nSCORE (réponses en rapport avec le message) : ${bons}/${total}`);
}

main();
