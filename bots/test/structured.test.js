// Tests sans serveur Minecraft ni passerelle : la passerelle est simulée par un faux fetch.
// Lancer avec : npm test

const test = require('node:test');
const assert = require('node:assert');
const { Gateway } = require('../src/llm/gateway');
const { callTool, extractJson } = require('../src/llm/structured');
const { validate } = require('../src/llm/schema');

const TOOLS = [
  { name: 'parler', description: 'chat', parameters: { type: 'object', properties: { message: { type: 'string', maxLength: 20 } }, required: ['message'] } },
];

const baseCfg = {
  baseUrl: 'http://faux', apiKey: '', model: 'test', mode: 'tools', toolChoice: 'auto',
  temperature: 0, maxTokens: 50, timeoutMs: 1000, maxRetries: 2, maxConcurrent: 1, minIntervalMs: 0,
};

function fakeLogger() {
  const lines = [];
  return { gameId: 'test', lines, write: (stream, r) => lines.push({ stream, ...r }) };
}

// Renvoie successivement les réponses données : { status, body } ou un message assistant.
function fakeFetch(responses) {
  let i = 0;
  const calls = [];
  const fn = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const r = responses[Math.min(i++, responses.length - 1)];
    const status = r.status ?? 200;
    const body = r.status ? r.body : JSON.stringify({ choices: [{ message: r, finish_reason: 'stop' }], usage: { total_tokens: 10 } });
    return { ok: status < 400, status, text: async () => body, headers: new Map([['x-litellm-response-cost', '0.0001']]) };
  };
  fn.calls = calls;
  return fn;
}

const toolCall = (name, args) => ({ tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] });
const baseArgs = (gateway, logger) => ({ gateway, logger, messages: [{ role: 'user', content: 'x' }], tools: TOOLS, meta: { agent: 'a', decisionId: 'a-1', kind: 'decision' } });

test("appel d'outil valide du premier coup", async () => {
  const fetchImpl = fakeFetch([toolCall('parler', { message: 'salut' })]);
  const logger = fakeLogger();
  const r = await callTool(baseArgs(new Gateway(baseCfg, { fetchImpl }), logger));
  assert.deepStrictEqual(r.args, { message: 'salut' });
  assert.strictEqual(logger.lines[0].valid, true);
  assert.strictEqual(logger.lines[0].cost_usd, 0.0001);
});

test('réponse invalide puis corrigée après relance', async () => {
  const fetchImpl = fakeFetch([toolCall('parler', { message: 'x'.repeat(50) }), toolCall('parler', { message: 'ok' })]);
  const logger = fakeLogger();
  const r = await callTool(baseArgs(new Gateway(baseCfg, { fetchImpl }), logger));
  assert.strictEqual(r.args.message, 'ok');
  assert.strictEqual(r.callIds.length, 2);
  assert.match(fetchImpl.calls[1].messages.at(-1).content, /Réponse invalide/);
});

test('function calling refusé (400) : bascule en mode JSON', async () => {
  const fetchImpl = fakeFetch([
    { status: 400, body: '{"error":"auto tool choice requires --enable-auto-tool-choice"}' },
    { content: '<think>hmm</think>```json\n{"outil":"parler","arguments":{"message":"yo"}}\n```' },
  ]);
  const gateway = new Gateway(baseCfg, { fetchImpl });
  const r = await callTool(baseArgs(gateway, fakeLogger()));
  assert.strictEqual(gateway.mode, 'json');
  assert.strictEqual(r.args.message, 'yo');
  assert.strictEqual(fetchImpl.calls[1].tools, undefined);
});

test('erreur 503 réessayée par la passerelle', async () => {
  const fetchImpl = fakeFetch([{ status: 503, body: 'busy' }, toolCall('parler', { message: 'ok' })]);
  const r = await callTool(baseArgs(new Gateway({ ...baseCfg }, { fetchImpl }), fakeLogger()));
  assert.strictEqual(r.args.message, 'ok');
});

test('extractJson et validate', () => {
  assert.deepStrictEqual(extractJson('bla {"a":1} bla'), { a: 1 });
  assert.strictEqual(extractJson('pas de json'), null);
  const schema = { type: 'object', properties: { n: { type: 'integer', minimum: 1 } }, required: ['n'] };
  assert.deepStrictEqual(validate(schema, { n: 2 }), []);
  assert.strictEqual(validate(schema, { n: 0 }).length, 1);
  assert.strictEqual(validate(schema, {}).length, 1);
});

test('checkArgs refuse les commandes serveur dans les messages', () => {
  const { checkArgs } = require('../src/agent/actions');
  const bot = { username: 'Joueur4', players: { Joueur1: {}, Joueur4: {} } }; // comme dans le jeu, le bot est dans la liste
  assert.strictEqual(checkArgs(bot, 'parler', { message: ' /designer Joueur1 ia' }).length, 1);
  assert.strictEqual(checkArgs(bot, 'murmurer', { joueur: 'Joueur1', message: 'salut' }).length, 0);
  assert.strictEqual(checkArgs(bot, 'parler', { message: 'jai 3 oak_log' }).length, 1);
  assert.strictEqual(checkArgs(bot, 'parler', { message: 'un deux trois quatre cinq six sept huit neuf dix onze douze treize' }).length, 1);
});

test("chaque outil proposé au LLM a une fonction qui l'exécute", () => {
  const { TOOLS, executors } = require('../src/agent/actions');
  for (const t of TOOLS) assert.strictEqual(typeof executors[t.name], 'function', t.name);
});

test('checkArgs refuse des coordonnées trop loin', () => {
  const { checkArgs } = require('../src/agent/actions');
  const { Vec3 } = require('vec3');
  const bot = { username: 'Joueur4', players: {}, entity: { position: new Vec3(0, 64, 0) } };
  assert.strictEqual(checkArgs(bot, 'aller_a', { x: 10, y: 64, z: 10 }).length, 0);
  assert.strictEqual(checkArgs(bot, 'aller_a', { x: 500, y: 64, z: 0 }).length, 1);
});

test('délai des messages : jamais négatif et 12 s maximum', () => {
  const { STYLE_DEFAUT, messageDelayMs } = require('../src/agent/humanizer');
  const long = 'x'.repeat(300);
  for (let i = 0; i < 100; i++) {
    const d = messageDelayMs(long, long, 0, STYLE_DEFAUT);
    assert.ok(d >= 0 && d <= 12000, String(d));
  }
  assert.strictEqual(messageDelayMs('salut', '', 60000, STYLE_DEFAUT), 0);
});

test('faute de frappe : inverse deux lettres et propose parfois la correction', () => {
  const { fauteDeFrappe } = require('../src/agent/humanizer');
  assert.deepStrictEqual(fauteDeFrappe('salut tout le monde', 0), { texte: 'salut tout le monde', correction: null });
  const f = fauteDeFrappe('pioche', 1);
  assert.strictEqual(f.texte.length, 6);
  assert.deepStrictEqual([...f.texte].sort(), [...'pioche'].sort());
  assert.ok(f.correction === null || f.correction === '*pioche');
});

test('accents : enlevés au hasard selon la probabilité de les garder', () => {
  const { enleverAccents } = require('../src/agent/humanizer');
  assert.strictEqual(enleverAccents('bien joué sérieux', 0), 'bien joue serieux');
  assert.strictEqual(enleverAccents('bien joué sérieux', 1), 'bien joué sérieux');
});


test('répétition : un message qui commence comme un des derniers est refusé', () => {
  const { Agent } = require('../src/agent/agent');
  const a = new Agent({ username: 'Joueur4', persona: '' }, { cfg: {}, gateway: {}, logger: {} });
  a.memory.chat.push({ from: 'Joueur4', text: "mdr t'es où gros ?", t: Date.now() - 600000 });
  assert.strictEqual(a.verifierRepetition('parler', { message: "mdr t'es ou gros ? je te vois pas" }).length, 1);
  assert.strictEqual(a.verifierRepetition('parler', { message: 'jvais couper du bois' }).length, 0);
});

test('écrire comme un joueur : pas de majuscule au début, pas de point final, apostrophe clavier', () => {
  const { ecrireCommeJoueur } = require('../src/agent/humanizer');
  assert.strictEqual(ecrireCommeJoueur('Mdr t’es où.'), "mdr t'es où");
});

test('répétition : "wsh tes ou frr" puis "wsh tes ou jte vois pas" est refusé', () => {
  const { Agent } = require('../src/agent/agent');
  const a = new Agent({ username: 'Joueur4', persona: '' }, { cfg: {}, gateway: {}, logger: {} });
  a.memory.chat.push({ from: 'Joueur4', text: "wsh t'es ou frr ?", t: Date.now() - 600000 });
  assert.strictEqual(a.verifierRepetition('parler', { message: "wsh t'es ou jte vois pas mdr" }).length, 1);
});

test('une demande de joueur n\'est pas écrasée par la minuterie', () => {
  const { Agent } = require('../src/agent/agent');
  const a = new Agent({ username: 'Joueur4', persona: '' }, { cfg: {}, gateway: {}, logger: {} });
  a.mcData = {};
  a.pense = true; // le cerveau est en train de décider
  a.schedule('message de SAHYGO', 0);
  a.schedule('minuterie (rien ne s\'est passé récemment)', 0);
  assert.strictEqual(a.pendingReason, 'message de SAHYGO');
  a.pense = false; // il ne décide pas : la décision est prévue dans 1,5 s
  a.schedule('message de SAHYGO', 1500);
  a.schedule('minuterie (rien ne s\'est passé récemment)', 0);
  assert.strictEqual(a.raisonPrevue, 'message de SAHYGO');
  clearTimeout(a.decideTimer);
});

test('fil de conversation : messages reçus et envoyés dans l\'ordre, sans les réflexes', () => {
  const { Agent } = require('../src/agent/agent');
  const { observe } = require('../src/agent/perception');
  const { Vec3 } = require('vec3');
  const a = new Agent({ username: 'Joueur4', persona: '' }, { cfg: { agent: { maxEvents: 15 } }, gateway: {}, logger: { write() {} } });
  a.onEvent({ type: 'chat', from: 'SAHYGO', text: 'viens' }, null);
  a.retenirMessage({ type: 'chat', from: 'Joueur4', text: 'jarrive' });
  a.onEvent({ type: 'reflexe', text: 'auto_defense : spider' }, null);
  const bot = { username: 'Joueur4', entity: { position: new Vec3(0, 64, 0) }, players: {}, entities: {}, health: 20, food: 20,
    inventory: { items: () => [] }, findBlocks: () => [], time: { timeOfDay: 0 } };
  a.memory.notes.push({ text: 'SAHYGO veut 5 cobble', t: Date.now() });
  const texte = observe(bot, { blocksArray: [] }, a.memory);
  assert.ok(texte.includes('SAHYGO veut 5 cobble'));
  assert.ok(texte.indexOf('<SAHYGO> viens') < texte.indexOf('<toi> jarrive'));
  assert.ok(texte.split('Autres évènements')[1].includes('auto_defense'));
  assert.ok(!texte.split('Autres évènements')[0].includes('auto_defense'));
});

test('réflexes : pas de plantage quand le bloc au-dessus de la tête est null (après une mort)', async () => {
  const { startReflexes } = require('../src/agent/reflexes');
  const { Vec3 } = require('vec3');
  const erreurs = [];
  const bot = {
    entity: { position: new Vec3(0, 64, 0), yaw: 0 },
    blockAt: () => null, // bloc pas encore chargé
    pathfinder: { isMoving: () => false },
    nearestEntity: () => null,
    look: async () => {},
    // comme mineflayer : refuse tout ce qui n'est pas un vrai booléen
    setControlState: (c, etat) => { assert.strictEqual(typeof etat, 'boolean'); },
  };
  const timer = startReflexes(bot, { rateCoup: 0 }, () => null, (type, detail) => erreurs.push(`${type} ${detail}`));
  await new Promise((r) => setTimeout(r, 250));
  clearInterval(timer);
  assert.deepStrictEqual(erreurs, []);
});

test('attendre s\'arrête dès qu\'un joueur parle au bot', async () => {
  const { executors } = require('../src/agent/actions');
  const bot = { interrompre: false };
  setTimeout(() => { bot.interrompre = true; }, 300);
  const t = Date.now();
  await executors.attendre(bot, { secondes: 10 });
  assert.ok(Date.now() - t < 2000);
});

test("demandes : ce qu'un joueur demande au bot reste affiché", () => {
  const { observe } = require('../src/agent/perception');
  const { Vec3 } = require('vec3');
  const memory = { events: [], chat: [], actions: [], notes: [], demandes: [{ from: 'SAHYGO', text: 'va chercher 5 bûches', t: Date.now() }], objectif: null };
  const bot = { username: 'Joueur4', entity: { position: new Vec3(0, 64, 0) }, players: {}, entities: {}, health: 20, food: 20,
    inventory: { items: () => [] }, findBlocks: () => [], time: { timeOfDay: 0 } };
  const texte = observe(bot, { blocksArray: [] }, memory);
  assert.ok(texte.includes("Ce qu'on t'a demandé"));
  assert.ok(texte.includes('<SAHYGO> va chercher 5 bûches'));
});

test('humain connecté : les autres agents ne comptent pas', () => {
  const { Agent } = require('../src/agent/agent');
  const a = new Agent({ username: 'Joueur4', persona: '' }, { cfg: { game: { agents: ['Joueur4', 'Joueur5'] } }, gateway: {}, logger: {} });
  a.bot = { players: { Joueur4: {}, Joueur5: {} } };
  assert.strictEqual(a.humainConnecte(), false);
  a.bot.players.SAHYGO = {};
  assert.strictEqual(a.humainConnecte(), true);
});

test('etat.jsonl : vie, faim, position et inventaire du bot', () => {
  const { Agent } = require('../src/agent/agent');
  const { Vec3 } = require('vec3');
  const lignes = [];
  const a = new Agent({ username: 'Joueur4', persona: '' }, { cfg: {}, gateway: {}, logger: { write: (f, r) => lignes.push({ f, ...r }) } });
  a.bot = { entity: { position: new Vec3(10.4, 64, -3.6) }, health: 17.5, food: 12, game: { dimension: 'overworld' }, time: { timeOfDay: 13000 },
    experience: { level: 2 }, players: { Joueur4: {}, SAHYGO: {} }, inventory: { items: () => [{ name: 'oak_log', count: 3 }, { name: 'oak_log', count: 2 }] } };
  a.noterEtat();
  assert.strictEqual(lignes[0].f, 'etat');
  assert.deepStrictEqual([lignes[0].vie, lignes[0].faim, lignes[0].x, lignes[0].nuit], [18, 12, 10, true]);
  assert.deepStrictEqual(lignes[0].inventaire, { oak_log: 5 });
});

function botDeTest(extra) {
  const { Vec3 } = require('vec3');
  return {
    entity: { position: new Vec3(0, 64, 0), yaw: 0 }, blockAt: () => ({ name: 'air' }),
    pathfinder: { isMoving: () => false, setGoal: () => {} }, nearestEntity: () => null,
    look: async () => {}, lookAt: async () => {}, setControlState: () => {},
    health: 20, food: 20, registry: { foodsByName: { bread: {}, rotten_flesh: {}, spider_eye: {} } },
    inventory: { items: () => [] }, equip: async () => {}, consume: async () => {}, ...extra,
  };
}

test('réflexe : il mange tout seul quand il a faim (jamais un oeil d\'araignée)', async () => {
  const { startReflexes } = require('../src/agent/reflexes');
  const evts = [];
  const bot = botDeTest({ food: 10, inventory: { items: () => [{ name: 'spider_eye' }, { name: 'bread' }] } });
  const t = startReflexes(bot, { rateCoup: 0 }, () => null, (type, d) => evts.push(`${type} ${d}`));
  await new Promise((r) => setTimeout(r, 300));
  clearInterval(t);
  assert.ok(evts.includes('manger bread'));
});

test('réflexe : vie basse et monstre proche, il fuit au lieu de se battre', async () => {
  const { startReflexes } = require('../src/agent/reflexes');
  const { Vec3 } = require('vec3');
  const evts = [];
  let but = null;
  const zombie = { name: 'zombie', type: 'hostile', position: new Vec3(3, 64, 0), height: 1.9 };
  const bot = botDeTest({ health: 4, nearestEntity: (f) => (f(zombie) ? zombie : null), pathfinder: { isMoving: () => false, setGoal: (g) => { but = g; } } });
  const t = startReflexes(bot, { rateCoup: 0 }, () => null, (type, d) => evts.push(type));
  await new Promise((r) => setTimeout(r, 250));
  clearInterval(t);
  assert.ok(evts.includes('fuite'));
  assert.ok(!evts.includes('auto_defense'));
  assert.ok(but && bot.interrompre);
});

test('perception : la nuit, peu de vie et faim sans nourriture sont signalés', () => {
  const { observe } = require('../src/agent/perception');
  const { Vec3 } = require('vec3');
  const memory = { events: [], chat: [], actions: [], notes: [], demandes: [], objectif: null };
  const bot = { username: 'Joueur4', entity: { position: new Vec3(0, 64, 0) }, players: {}, entities: {}, health: 5, food: 4,
    inventory: { items: () => [] }, findBlocks: () => [], time: { timeOfDay: 15000 }, registry: { foodsByName: {} } };
  const texte = observe(bot, { blocksArray: [] }, memory);
  assert.ok(texte.includes("c'est la nuit"));
  assert.ok(texte.includes('peu de vie'));
  assert.ok(texte.includes('rien à manger'));
});

test('perception : idées de bon sens (bois sans pioche, trop de bois, faim sans nourriture)', () => {
  const { observe } = require('../src/agent/perception');
  const { Vec3 } = require('vec3');
  const memory = { events: [], chat: [], actions: [], notes: [], demandes: [], objectif: null };
  const bot = { username: 'Joueur4', entity: { position: new Vec3(0, 64, 0) }, players: {}, entities: {}, health: 20, food: 12,
    inventory: { items: () => [{ name: 'oak_log', count: 40 }] }, findBlocks: () => [], time: { timeOfDay: 1000 }, registry: { foodsByName: {} } };
  const texte = observe(bot, { blocksArray: [] }, memory);
  assert.ok(texte.includes('une table de craft puis une pioche'));
  assert.ok(texte.includes('beaucoup de bois'));
  assert.ok(texte.includes('explorer pour en trouver'));
  bot.inventory.items = () => [{ name: 'oak_log', count: 2 }, { name: 'wooden_pickaxe', count: 1 }];
  bot.food = 20;
  assert.ok(!observe(bot, { blocksArray: [] }, memory).includes('Idées'));
});

test('chasser : sans animal proche, le bot est invité à explorer', async () => {
  const { executors } = require('../src/agent/actions');
  await assert.rejects(executors.chasser({ nearestEntity: () => null }, {}, { style: { rateCoup: 0 } }), /explore/);
});

test('noms d\'objets approximatifs traduits en identifiants Minecraft', () => {
  const { nomObjet } = require('../src/agent/actions');
  const bot = { registry: require('minecraft-data')('1.20.4'), inventory: { items: () => [{ name: 'birch_log', count: 4 }] } };
  assert.strictEqual(nomObjet(bot, 'planches'), 'birch_planks');
  assert.strictEqual(nomObjet(bot, 'planks'), 'birch_planks');
  assert.strictEqual(nomObjet(bot, 'table de craft'), 'crafting_table');
  assert.strictEqual(nomObjet(bot, 'Bâtons'), 'stick');
  assert.strictEqual(nomObjet(bot, 'wooden_pickaxe'), 'wooden_pickaxe');
});

test('explorer : garde à peu près la même direction et va à 30-60 blocs, change si bloqué', async () => {
  const { executors } = require('../src/agent/actions');
  const { Vec3 } = require('vec3');
  const buts = [];
  let bloque = false;
  const bot = { entity: { position: new Vec3(0, 64, 0) },
    pathfinder: { goto: async (g) => { buts.push(g); if (bloque) throw new Error('bloqué'); }, setGoal: () => {} } };
  await executors.explorer(bot);
  await executors.explorer(bot);
  const cap = (g) => Math.atan2(g.z, g.x);
  const ecart = Math.abs(Math.atan2(Math.sin(cap(buts[0]) - cap(buts[1])), Math.cos(cap(buts[0]) - cap(buts[1]))));
  assert.ok(ecart <= 0.8, `écart de direction ${ecart}`);
  // 30 à 60 blocs, mais le but arrondit les coordonnées à l'entier : on mesure entre 29 et 61.
  const dist = Math.hypot(buts[0].x, buts[0].z);
  assert.ok(dist >= 29 && dist <= 61, `distance ${dist}`);
  bloque = true;
  await assert.rejects(executors.explorer(bot), /bloqué/);
  assert.strictEqual(bot.capExploration, undefined);
});

test('perception : idée précise quand il a tout pour une pioche, même affamé', () => {
  const { observe } = require('../src/agent/perception');
  const { Vec3 } = require('vec3');
  const memory = { events: [], chat: [], actions: [], notes: [], demandes: [], objectif: null };
  const inv = [{ name: 'oak_planks', count: 64 }, { name: 'stick', count: 35 }, { name: 'crafting_table', count: 1 }];
  const bot = { username: 'Joueur4', entity: { position: new Vec3(0, 64, 0) }, players: {}, entities: {}, health: 10, food: 0,
    inventory: { items: () => inv }, findBlocks: () => [], time: { timeOfDay: 1000 }, registry: { foodsByName: {} } };
  const texte = observe(bot, { blocksArray: [] }, memory);
  assert.ok(texte.includes('fabriquer wooden_pickaxe'));
  assert.ok(texte.includes('explorer pour en trouver'));
});

test('perception : animal en vue et faim -> conseil de chasser', () => {
  const { observe } = require('../src/agent/perception');
  const { Vec3 } = require('vec3');
  const memory = { events: [], chat: [], actions: [], notes: [], demandes: [], objectif: null };
  const bot = { username: 'Joueur4', entity: { position: new Vec3(0, 64, 0) }, players: {}, health: 20, food: 8,
    entities: { 1: { name: 'cow', position: new Vec3(20, 64, 0) }, 2: { name: 'cow', position: new Vec3(90, 64, 0) } },
    inventory: { items: () => [] }, findBlocks: () => [], time: { timeOfDay: 1000 }, registry: { foodsByName: {} } };
  const texte = observe(bot, { blocksArray: [] }, memory);
  assert.ok(texte.includes('Animaux en vue : cow à 20 blocs.'));
  assert.ok(texte.includes('(cow à 20 blocs) : chasser'));
});

test('parler : refusé quand personne d\'autre n\'est connecté', () => {
  const { checkArgs } = require('../src/agent/actions');
  assert.strictEqual(checkArgs({ username: 'Joueur4', players: { Joueur4: {} } }, 'parler', { message: 't ou' }).length, 1);
  assert.strictEqual(checkArgs({ username: 'Joueur4', players: { Joueur4: {}, SAHYGO: {} } }, 'parler', { message: 't ou' }).length, 0);
});

test('mission : affichée au bot à chaque décision', () => {
  const { observe } = require('../src/agent/perception');
  const { Vec3 } = require('vec3');
  const memory = { events: [], chat: [], actions: [], notes: [], demandes: [], objectif: null, mission: 'obtenir un casque en diamant' };
  const bot = { username: 'Joueur4', entity: { position: new Vec3(0, 64, 0) }, players: {}, entities: {}, health: 20, food: 20,
    inventory: { items: () => [] }, findBlocks: () => [], time: { timeOfDay: 1000 }, registry: { foodsByName: {} } };
  assert.ok(observe(bot, { blocksArray: [] }, memory).includes('Ta mission : obtenir un casque en diamant'));
});

test('actions Mindcraft : sans les ingredients, le modele recoit ce qui manque', async () => {
  const { executors } = require('../src/agent/actions');
  const bot = { version: '1.20.4', registry: require('minecraft-data')('1.20.4'), inventory: { items: () => [] }, recipesFor: () => [] };
  await assert.rejects(executors.fabriquer(bot, { objet: 'stone_pickaxe', quantite: 1 }), /resources/);
});

test('perception : pioche cassee et de la cobble -> idee de pioche en pierre', () => {
  const { observe } = require('../src/agent/perception');
  const { Vec3 } = require('vec3');
  const memory = { events: [], chat: [], actions: [], notes: [], demandes: [], objectif: null };
  const inv = [{ name: 'oak_planks', count: 14 }, { name: 'cobblestone', count: 45 }];
  const bot = { username: 'Joueur4', entity: { position: new Vec3(0, 64, 0) }, players: {}, entities: {}, health: 20, food: 20,
    inventory: { items: () => inv }, findBlocks: () => [], time: { timeOfDay: 1000 }, registry: { foodsByName: {} } };
  const texte = observe(bot, { blocksArray: [] }, memory);
  assert.ok(texte.includes('fabriquer stone_pickaxe'));
  assert.ok(!texte.includes('wooden_pickaxe'));
});

test('plan : prochaine etape vers le casque en diamant selon l inventaire', async () => {
  const { prochaineEtape, objetDeMission } = require('../src/agent/plan');
  const mc = await import('../src/mindcraft/mcdata.mjs');
  mc.init('1.20.4');
  const etape = (inv) => prochaineEtape('diamond_helmet', Object.entries(inv).map(([name, count]) => ({ name, count })), mc.getItemCraftingRecipes);
  assert.match(etape({}), /^collecter oak_log/);
  assert.strictEqual(etape({ birch_log: 3 }), 'fabriquer birch_planks');
  assert.match(etape({ wooden_pickaxe: 1, stick: 4, oak_planks: 4 }), /^collecter stone/);
  assert.match(etape({ stone_pickaxe: 1, crafting_table: 1 }), /^collecter iron_ore/);
  assert.match(etape({ stone_pickaxe: 1, raw_iron: 3, furnace: 1, crafting_table: 1 }), /^cuire raw_iron/);
  assert.match(etape({ iron_pickaxe: 1, crafting_table: 1 }), /^collecter diamond_ore/);
  assert.strictEqual(etape({ iron_pickaxe: 1, diamond: 5, crafting_table: 1 }), 'fabriquer diamond_helmet');
  assert.strictEqual(etape({ diamond_helmet: 1 }), null);
  assert.strictEqual(objetDeMission('obtenir un casque en diamant (diamond_helmet)', require('minecraft-data')('1.20.4')), 'diamond_helmet');
});

test('enchainement : relance apres une action, la demande d un joueur passe avant', () => {
  const { Agent } = require('../src/agent/agent');
  const a = new Agent({ username: 'Joueur4', persona: '' }, { cfg: { agent: { sansHumain: true } }, gateway: {}, logger: {} });
  const appels = [];
  a.schedule = (raison, ms) => appels.push([raison, ms]);
  a.suite('ton action collecter vient de finir (réussie)');
  assert.strictEqual(appels[0][0], 'ton action collecter vient de finir (réussie)');
  assert.ok(appels[0][1] >= 1000 && appels[0][1] <= 3000);
  a.pendingReason = 'SAHYGO te parle';
  a.suite('ton action collecter vient de finir (réussie)');
  assert.deepStrictEqual(appels[1], ['SAHYGO te parle', 500]);
  a.suite(null); // decision ratee : pas de relance (sinon boucle si la passerelle est en panne)
  assert.strictEqual(appels.length, 2);
});

test('fabriquer plusieurs objets : une fabrication a la fois (bug d inventaire sur Paper)', async () => {
  const { executors } = require('../src/agent/actions');
  const mcData = require('minecraft-data')('1.20.4');
  const appels = [];
  const recette = { inShape: [[{ id: mcData.itemsByName.oak_planks.id, count: 1 }], [{ id: mcData.itemsByName.oak_planks.id, count: 1 }]] };
  const planches = { name: 'oak_planks', count: 8 };
  const bot = { version: '1.20.4', registry: mcData, inventory: { items: () => [planches], slots: [planches] },
    recipesFor: () => [recette], craft: async (r, n) => appels.push(n), armorManager: { equipAll() {} } };
  await executors.fabriquer(bot, { objet: 'stick', quantite: 4 });
  assert.deepStrictEqual(appels, [1, 1, 1, 1]);
});

test('demandes : le bot voit la demande ET son etape, ses promesses, et choisit selon son caractere', () => {
  const { observe } = require('../src/agent/perception');
  const { Vec3 } = require('vec3');
  const memory = { events: [], chat: [], actions: [], notes: [], demandes: [{ from: 'SAHYGO', text: 'on remonte', t: Date.now() }], objectif: null, etape: 'collecter diamond_ore (5)' };
  const bot = { username: 'Joueur4', entity: { position: new Vec3(0, -50, 0) }, players: {}, entities: {}, health: 20, food: 20,
    inventory: { items: () => [] }, findBlocks: () => [], blockAt: () => ({ skyLight: 0 }), time: { timeOfDay: 1000 }, registry: { foodsByName: {} } };
  const texte = observe(bot, { blocksArray: [] }, memory);
  assert.ok(texte.includes('Prochaine étape'));
  assert.ok(texte.includes('on remonte'));
  assert.ok(texte.includes('sous terre'));
  memory.promesses = [{ text: 'aider SAHYGO a couper du bois', t: Date.now() }];
  assert.ok(observe(bot, { blocksArray: [] }, memory).includes('aider SAHYGO a couper du bois'));
  const { systemPrompt } = require('../src/agent/prompt');
  assert.ok(systemPrompt('Joueur5', '', { serviable: 0.3, flemme: 0.2 }, 'motivé').includes('serviable 3/10, flemme 2/10'));
});

test('aller vers un joueur trop loin : conseil de demander ses coordonnees', async () => {
  const { executors } = require('../src/agent/actions');
  await assert.rejects(executors.aller_vers_joueur({ players: { SAHYGO: {} } }, { joueur: 'SAHYGO' }), /coordonnées/);
});

test('profils : l etape suit le premier objectif pas encore atteint', async () => {
  const { Agent } = require('../src/agent/agent');
  const mc = await import('../src/mindcraft/mcdata.mjs');
  mc.init('1.20.4');
  const profil = require('../agents.json').find((p) => p.username === 'Kr0nos_');
  const a = new Agent(profil, { cfg: { agent: { mission: '' } }, gateway: {}, logger: {} });
  a.recettes = mc.getItemCraftingRecipes;
  a.mcData = require('minecraft-data')('1.20.4');
  const bot = (inv) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })) } });
  assert.match(a.etapeDuMoment(bot({})), /^collecter oak_log/);
  // Joueur5 est le mineur : pioches, 64 pierres, 16 charbons, puis la pioche en fer.
  const stock = { stone_pickaxe: 1, cobblestone: 64, coal: 16, stick: 4, crafting_table: 1 };
  assert.match(a.etapeDuMoment(bot({ stone_pickaxe: 1, cobblestone: 10 })), /^collecter stone/);
  assert.strictEqual(a.etapeDuMoment(bot({ ...stock, iron_ingot: 1 })), 'collecter iron_ore (2), creuser vers y=16 ou chercher une grotte');
  assert.strictEqual(a.etapeDuMoment(bot({ ...stock, iron_ingot: 3 })), 'fabriquer iron_pickaxe');
});

test('cabane : murs avec une porte, toit du bord vers le centre', () => {
  const { plansCabane, NB_BLOCS } = require('../src/agent/construction');
  const { Vec3 } = require('vec3');
  const plans = plansCabane(new Vec3(10, 64, 20));
  assert.strictEqual(NB_BLOCS, 16 * 3 - 2 + 25);
  assert.ok(!plans.some((b) => b.pos.equals(new Vec3(12, 64, 20)))); // la porte reste vide
  const toit = plans.filter((b) => b.partie === 'toit');
  assert.ok(plans.indexOf(toit[0]) > plans.filter((b) => b.partie === 'mur').length - 1); // murs d'abord
  assert.ok(toit[toit.length - 1].pos.equals(new Vec3(12, 67, 22))); // le centre du toit en dernier
});

test('builder : il va chercher des planches avant de construire', async () => {
  const { Agent } = require('../src/agent/agent');
  const mc = await import('../src/mindcraft/mcdata.mjs');
  mc.init('1.20.4');
  const profil = require('../agents.json').find((p) => p.username === 'Lunaa_44');
  const a = new Agent(profil, { cfg: { agent: { mission: '' } }, gateway: {}, logger: {} });
  a.recettes = mc.getItemCraftingRecipes;
  a.mcData = require('minecraft-data')('1.20.4');
  const bot = (inv) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })) } });
  const outils = { stone_axe: 1, stone_pickaxe: 1 };
  assert.match(a.etapeDuMoment(bot({ ...outils, cobblestone: 40 })), /^collecter oak_log/);
  assert.strictEqual(a.etapeDuMoment(bot({ ...outils, cobblestone: 46, oak_planks: 30 })), 'construire (ta cabane)');
});

test('manger sans nourriture : refuse avant d agir, conseil de chasser', () => {
  const { checkArgs } = require('../src/agent/actions');
  const bot = { registry: require('minecraft-data')('1.20.4'), inventory: { items: () => [{ name: 'spruce_log', count: 96 }] }, players: {}, username: 'Joueur6' };
  assert.match(checkArgs(bot, 'manger', {}).join(' '), /chasse/);
  bot.inventory.items = () => [{ name: 'beef', count: 1 }];
  assert.deepStrictEqual(checkArgs(bot, 'manger', {}), []);
});

test('perception : evenements identiques regroupes, notes en double affichees une fois', () => {
  const { observe } = require('../src/agent/perception');
  const { Vec3 } = require('vec3');
  const t = Date.now();
  const fuite = { type: 'reflexe', text: 'fuite : skeleton, vie 6', t };
  const memory = { events: [fuite, fuite, fuite], chat: [], actions: [], notes: [{ text: 'miner pierre', t }, { text: 'miner pierre', t }], demandes: [] };
  const bot = { username: 'Joueur4', entity: { position: new Vec3(0, 64, 0) }, players: {}, entities: {}, health: 20, food: 20,
    inventory: { items: () => [] }, findBlocks: () => [], time: { timeOfDay: 1000 }, registry: { foodsByName: {} } };
  const texte = observe(bot, { blocksArray: [] }, memory);
  assert.strictEqual(texte.split('fuite : skeleton').length, 2);
  assert.ok(texte.includes('(x3)'));
  assert.strictEqual(texte.split('miner pierre').length, 2);
});

test('repetition : meme idee avec d autres mots, ou question restee sans reponse', () => {
  const { Agent } = require('../src/agent/agent');
  const a = new Agent({ username: 'Joueur4', persona: '' }, { cfg: {}, gateway: {}, logger: {} });
  a.memory.chat.push({ from: 'Joueur4', text: 'tas besoin fer ?', t: Date.now() - 600000 });
  assert.strictEqual(a.verifierRepetition('parler', { message: 'tas toujours besoin fer ?' }).length, 1);
  a.memory.chat.push({ from: 'Joueur4', text: 'vous faites quoi', t: Date.now() - 10000 });
  a.memory.chat.push({ from: 'Joueur4', text: 'qq1 a du bois ?', t: Date.now() - 150000 });
  assert.match(a.verifierRepetition('parler', { message: 'tu veux du charbon ?' })[0], /personne n'a répondu/);
  a.memory.chat.push({ from: 'Joueur5', text: 'nan', t: Date.now() });
  assert.deepStrictEqual(a.verifierRepetition('parler', { message: 'tu veux du charbon ?' }), []);
});

test('fabriquer sans table posee : une recette qui demande une table passe par la table', async () => {
  const { executors } = require('../src/agent/actions');
  const mcData = require('minecraft-data')('1.20.4');
  const appels = [];
  const recette = { requiresTable: true, inShape: [[{ id: mcData.itemsByName.cobblestone.id, count: 1 }]] };
  const bot = { version: '1.20.4', registry: mcData, inventory: { items: () => [], slots: [] },
    recipesFor: (id, m, n, table) => (table === null ? [recette] : []), craft: async (r, n, t) => appels.push(t) };
  await assert.rejects(executors.fabriquer(bot, { objet: 'stone_axe', quantite: 1 }));
  assert.deepStrictEqual(appels, []); // avant : bot.craft(recette avec table, sans table) -> erreur
});

test('outils proposes : pas de manger sans nourriture, pas de chat seul, pas de coffre sans coffre', () => {
  const { outilsUtiles } = require('../src/agent/actions');
  const { Vec3 } = require('vec3');
  const bot = { entity: { position: new Vec3(0, 64, 0) }, players: { Joueur6: {} }, registry: require('minecraft-data')('1.20.4'),
    inventory: { items: () => [] }, findBlock: () => null, nearestEntity: () => null, time: { timeOfDay: 1000 } };
  const noms = outilsUtiles(bot).map((t) => t.name);
  for (const absent of ['manger', 'parler', 'voir_coffre', 'fuir', 'dormir', 'remonter', 'chasser', 'construire']) assert.ok(!noms.includes(absent), absent);
  assert.ok(noms.includes('collecter'));
  bot.inventory.items = () => [{ name: 'beef', count: 1 }, { name: 'cobblestone', count: 40 }];
  bot.nearestEntity = (f) => [{ name: 'cow', position: new Vec3(5, 64, 0) }].find(f);
  const avec = outilsUtiles(bot).map((t) => t.name);
  for (const present of ['manger', 'construire', 'chasser']) assert.ok(avec.includes(present), present);
});

test('meme action ratee 2 fois : la 3e est refusee ; message a tout le monde = pour moi', () => {
  const { Agent } = require('../src/agent/agent');
  const a = new Agent({ username: 'Joueur5', persona: '' }, { cfg: {}, gateway: {}, logger: {} });
  const echec = { name: 'cuire', args: { objet: 'raw_iron', quantite: 1 }, ok: false, result: 'You have no fuel to smelt raw_iron' };
  a.memory.actions.push(echec, { ...echec, args: { ...echec.args, pensee: 'il me faut du fer' } });
  assert.match(a.verifierEchecs('cuire', { objet: 'raw_iron', quantite: 1, pensee: 'encore' })[0], /2 fois/);
  assert.deepStrictEqual(a.verifierEchecs('cuire', { objet: 'raw_iron', quantite: 2 }), []);
  const { turnPrompt } = require('../src/agent/prompt');
  assert.ok(!turnPrompt('obs', 'ton action collecter vient de finir (réussie)', true).includes("Personne ne t'a parlé"));
});

test('demande a tout le monde : le bot a qui ca coute le moins reagit en premier, les autres laissent faire', () => {
  const { objetDemande, coutDemande, delaiReaction, dejaRepondu } = require('../src/agent/demandes');
  const registry = require('minecraft-data')('1.20.4');
  assert.strictEqual(objetDemande('qqun a de la laine ?', [{ name: 'white_wool', count: 3 }], registry), 3);
  assert.strictEqual(objetDemande('qqun a de la laine ?', [{ name: 'dirt', count: 3 }], registry), 0);
  assert.strictEqual(objetDemande('vous faites quoi', [], registry), null);
  // Exemple du document docs/reactions-des-bots.md
  const chill = coutDemande({ possede: 3, distance: 10, occupe: false, serviable: 0.8 });
  const rusher = coutDemande({ possede: 0, distance: 40, occupe: true, serviable: 0.3 });
  const builder = coutDemande({ possede: 0, distance: null, occupe: true, serviable: 0.5 });
  assert.ok(Math.abs(chill - 0.9) < 1e-9 && Math.abs(rusher - 6.4) < 1e-9 && Math.abs(builder - 5.5) < 1e-9);
  assert.ok(delaiReaction(chill) < delaiReaction(builder) && delaiReaction(builder) < delaiReaction(rusher));
  const t = Date.now();
  assert.ok(dejaRepondu([{ from: 'Joueur4', text: 'jen ai tiens', t: t + 3000 }], 'SAHYGO', t, 'Joueur5'));
  assert.ok(!dejaRepondu([{ from: 'SAHYGO', text: 'allo ?', t: t + 3000 }], 'SAHYGO', t, 'Joueur5'));
});

test('perception : liste de ce qu il peut fabriquer tout de suite', () => {
  const { observe } = require('../src/agent/perception');
  const { Vec3 } = require('vec3');
  const registry = require('minecraft-data')('1.20.4');
  const inv = [{ name: 'oak_log', count: 2 }];
  const bot = { username: 'Joueur4', entity: { position: new Vec3(0, 64, 0) }, players: {}, entities: {}, health: 20, food: 20, registry,
    inventory: { items: () => inv }, findBlocks: () => [], findBlock: () => null, time: { timeOfDay: 1000 },
    recipesFor: (id) => (id === registry.itemsByName.oak_planks.id ? [{ requiresTable: false }] : [{ requiresTable: true }]) };
  const texte = observe(bot, { blocksArray: [] }, { events: [], chat: [], actions: [], notes: [], demandes: [] });
  assert.match(texte, /Tu peux fabriquer maintenant : oak_planks\./);
});

test('parole : repond sans toucher a l action ; un engagement reveille le cerveau des actions', async () => {
  const { Agent } = require('../src/agent/agent');
  const { Vec3 } = require('vec3');
  let reponse = { repond_a: 'Joueur6 me demande de la pierre', dire: 'ouais jen ai une quarantaine', engagement: 'rien', pensee: 'il me demande juste' };
  const gateway = { cfg: { model: 'test', toolChoice: 'auto' }, mode: 'tools',
    chat: async () => ({ message: { role: 'assistant', tool_calls: [{ function: { name: 'repondre', arguments: JSON.stringify(reponse) } }] }, finishReason: 'tool_calls' }) };
  const a = new Agent({ username: 'Joueur4', persona: '', vie: '19 ans, Lille' }, { cfg: { agent: { humanize: false }, llm: { maxFormatRetries: 0 } }, gateway, logger: { write() {}, gameId: 't' } });
  a.mcData = {};
  const envoyes = [];
  a.bot = { username: 'Joueur4', entity: { position: new Vec3(0, 64, 0) }, players: { Joueur4: {}, Joueur6: {} }, health: 20, food: 20,
    inventory: { items: () => [{ name: 'cobblestone', count: 40 }] }, time: { timeOfDay: 1000 }, registry: require('minecraft-data')('1.20.4'), chat: (m) => envoyes.push(m) };
  const relances = [];
  a.schedule = (r) => relances.push(r);
  a.actionEnCours = 'collecter';
  a.memory.chat.push({ from: 'Joueur6', text: 'joueur4 tas de la pierre ?', t: Date.now() });
  assert.match(a.filConversation(), /Joueur6 \(à toi\) : joueur4 tas de la pierre/);
  await a.parler('Joueur6 vient d\'écrire : "joueur4 tas de la pierre ?"');
  assert.deepStrictEqual(envoyes, ['ouais jen ai une quarantaine']);
  assert.deepStrictEqual(relances, []); // pas d'engagement : son action continue
  reponse = { repond_a: 'Joueur6 veut que je lui en passe', dire: 'ok jte file 10', engagement: 'donner 10 cobblestone à Joueur6' };
  await a.parler('Joueur6 vient d\'écrire : "tu men passes ?"');
  assert.strictEqual(a.memory.engagement.text, 'donner 10 cobblestone à Joueur6');
  assert.deepStrictEqual(relances, ["tu t'es engagé dans le chat : donner 10 cobblestone à Joueur6"]);
});

test('filtre des messages : argot repete enleve, messages vides ou deja dits pas envoyes', () => {
  const { filtrerMessage } = require('../src/agent/humanizer');
  assert.strictEqual(filtrerMessage('mdr il pleut', ['jai du fer mdr']), 'il pleut');
  assert.strictEqual(filtrerMessage('mdr il pleut', ['ok']), 'mdr il pleut');
  assert.strictEqual(filtrerMessage('encore', []), null);
  assert.strictEqual(filtrerMessage('jfais le toit', ['jfais le toit']), null);
});

test('reflexion : resume, avis, intention et defi adopte devient l etape suivante', async () => {
  const { Agent } = require('../src/agent/agent');
  const { Vec3 } = require('vec3');
  const mc = await import('../src/mindcraft/mcdata.mjs');
  mc.init('1.20.4');
  const reflexion = { resume: 'jai fait ma pioche en fer, SAHYGO lance un defi', avis: [{ joueur: 'SAHYGO', avis: 'marrant mais insistant' }],
    intention: 'faire le bloc de diams pour gagner', nouvel_objectif: 'diamond_block', nombre: 1 };
  const gateway = { cfg: { model: 'test', toolChoice: 'auto' }, mode: 'tools',
    chat: async () => ({ message: { role: 'assistant', tool_calls: [{ function: { name: 'reflexion', arguments: JSON.stringify(reflexion) } }] }, finishReason: 'tool_calls' }) };
  const a = new Agent(require('../agents.json')[1], { cfg: { agent: { humanize: false, mission: '' }, llm: { maxFormatRetries: 0 } }, gateway, logger: { write() {}, gameId: 't' } });
  a.mcData = {};
  a.recettes = mc.getItemCraftingRecipes;
  const inv = [{ name: 'iron_pickaxe', count: 1 }];
  a.bot = { username: 'Joueur5', entity: { position: new Vec3(0, 64, 0) }, players: {}, entities: {}, health: 20, food: 20,
    inventory: { items: () => inv }, findBlocks: () => [], time: { timeOfDay: 1000 }, registry: require('minecraft-data')('1.20.4') };
  await a.reflechir();
  assert.strictEqual(a.memory.avis.SAHYGO, 'marrant mais insistant');
  assert.strictEqual(a.memory.reflexion.intention, 'faire le bloc de diams pour gagner');
  assert.match(a.etapeDuMoment(a.bot), /^collecter diamond_ore \(9\)/);
  inv.push({ name: 'diamond_block', count: 1 });
  a.etapeDuMoment(a.bot);
  assert.strictEqual(a.memory.objectifPerso, null); // objectif atteint : on revient au profil
});

test('inventaire plein : idee de jeter ; porc et poulet : chasser puis cuire', async () => {
  const { observe } = require('../src/agent/perception');
  const { Vec3 } = require('vec3');
  const bot = { username: 'Joueur5', entity: { position: new Vec3(0, 64, 0) }, players: {}, entities: {}, health: 20, food: 20,
    inventory: { items: () => [{ name: 'cobblestone', count: 64 }], emptySlotCount: () => 1 }, findBlocks: () => [], time: { timeOfDay: 1000 }, registry: { foodsByName: {} } };
  assert.match(observe(bot, { blocksArray: [] }, { events: [], chat: [], actions: [], notes: [], demandes: [] }), /presque plein/);
  const { prochaineEtape } = require('../src/agent/plan');
  const mc = await import('../src/mindcraft/mcdata.mjs');
  mc.init('1.20.4');
  assert.match(prochaineEtape('cooked_porkchop', [], mc.getItemCraftingRecipes), /^chasser pig/);
});

test('limite de tokens : plus aucun appel au modele une fois la limite atteinte', async () => {
  const { Gateway } = require('../src/llm/gateway');
  let appels = 0;
  const fetchImpl = async () => { appels++; return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { total_tokens: 600 } }) }; };
  const g = new Gateway({ model: 'test', baseUrl: 'http://x', maxConcurrent: 1, minIntervalMs: 0, maxRetries: 0, timeoutMs: 1000, budgetTokens: 1000 }, { fetchImpl });
  await g.chat({ messages: [] });
  await g.chat({ messages: [] });
  await assert.rejects(g.chat({ messages: [] }), /limite de 1000 tokens/);
  assert.strictEqual(appels, 2);
});

test('combat contre un joueur : seulement s il m a frappe ou si un duel est propose', () => {
  const { Agent } = require('../src/agent/agent');
  const a = new Agent({ username: 'Joueur5', persona: '' }, { cfg: {}, gateway: {}, logger: {} });
  assert.match(a.verifierCombat('combattre', { joueur: 'SAHYGO' })[0], /duel/);
  a.frappePar.SAHYGO = Date.now();
  assert.deepStrictEqual(a.verifierCombat('combattre', { joueur: 'SAHYGO' }), []);
  a.memory.chat.push({ from: 'Joueur4', text: 'joueur6 1v1 ?', t: Date.now() });
  assert.deepStrictEqual(a.verifierCombat('combattre', { joueur: 'Joueur4' }), []);
  assert.strictEqual(a.verifierCombat('combattre', { joueur: 'Joueur6' }).length, 0);
});

test('reflexion : un seul objectif personnel a la fois, et seulement s il est faisable', async () => {
  const { Agent } = require('../src/agent/agent');
  const { Vec3 } = require('vec3');
  const mc = await import('../src/mindcraft/mcdata.mjs');
  mc.init('1.20.4');
  let objectif = 'diamond_block';
  const gateway = { cfg: { model: 'test', toolChoice: 'auto' }, mode: 'tools',
    chat: async () => ({ message: { role: 'assistant', tool_calls: [{ function: { name: 'reflexion', arguments: JSON.stringify({ resume: 'r', intention: 'i', nouvel_objectif: objectif }) } }] }, finishReason: 'tool_calls' }) };
  const a = new Agent(require('../agents.json')[1], { cfg: { agent: { humanize: false, mission: '' }, llm: { maxFormatRetries: 0 } }, gateway, logger: { write() {}, gameId: 't' } });
  a.mcData = {};
  a.recettes = mc.getItemCraftingRecipes;
  a.bot = { username: 'Joueur5', entity: { position: new Vec3(0, 64, 0) }, players: {}, entities: {}, health: 20, food: 20,
    inventory: { items: () => [] }, findBlocks: () => [], time: { timeOfDay: 1000 }, registry: require('minecraft-data')('1.20.4') };
  await a.reflechir();
  assert.strictEqual(a.memory.objectifPerso.objet, 'diamond_block');
  objectif = 'feather';
  await a.reflechir();
  assert.strictEqual(a.memory.objectifPerso.objet, 'diamond_block'); // pas de changement de projet toutes les 3 min
});

test('chat : a qui s adresse un message, messages sans contenu, coordonnees annoncees', () => {
  const { citeUnAutre, sansContenu, positionAnnoncee } = require('../src/agent/demandes');
  const joueurs = ['Joueur4', 'Joueur5', 'Joueur6', 'DrAlphaCheat'];
  assert.strictEqual(citeUnAutre('je suis avec toi joueur 4', 'Joueur6', joueurs), true); // pas pour Joueur6
  assert.strictEqual(citeUnAutre('je suis avec toi joueur 4', 'Joueur4', joueurs), false);
  assert.strictEqual(sansContenu('merci'), true);
  assert.strictEqual(sansContenu('bonne chance alors'), true);
  assert.strictEqual(sansContenu('merci tu peux men donner encore ?'), false);
  assert.deepStrictEqual(positionAnnoncee('je suis en 0 0 maintenant'), { x: 0, z: 0 });
  assert.deepStrictEqual(positionAnnoncee('28 64 31'), { x: 28, y: 64, z: 31 });
  assert.strictEqual(positionAnnoncee('jai 15 bois'), null);
});

test('creuser : jamais plus bas que le niveau des diamants (bedrock)', async () => {
  const { executors } = require('../src/agent/actions');
  const { Vec3 } = require('vec3');
  await assert.rejects(executors.creuser({ entity: { position: new Vec3(0, -59, 0) } }, { blocs: 10 }), /tout en bas/);
});

test('donner a un joueur trop loin : va a ses coordonnees annoncees, sinon les demande', async () => {
  const { executors } = require('../src/agent/actions');
  await assert.rejects(executors.donner({ players: { DrAlphaCheat: {} } }, { joueur: 'DrAlphaCheat', objet: 'oak_log', quantite: 5 }), /demande-les-lui/);
});

test('filtre : un message avec une insulte grave n est jamais envoye', () => {
  const { filtrerMessage } = require('../src/agent/humanizer');
  assert.strictEqual(filtrerMessage("jsais pas c'est qui le sale noir", []), null);
  assert.strictEqual(filtrerMessage('calme toi', []), 'calme toi');
});

test('journaux : un fichier par bot quand chaque bot a son programme', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { JsonlLogger } = require('../src/observability/logger');
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'partie-'));
  const l4 = new JsonlLogger(dossier, 'test', 'Joueur4');
  const tous = new JsonlLogger(dossier, 'test');
  l4.write('actions', { agent: 'Joueur4' });
  tous.write('actions', { agent: 'Joueur5' });
  await l4.close();
  await tous.close();
  assert.deepStrictEqual(fs.readdirSync(dossier).sort(), ['actions-Joueur4.jsonl', 'actions.jsonl']);
});

test('ferme : enclos de 16 barrieres avec un portillon, interieur de 3 x 3', () => {
  const { plansEnclos, dansEnclos } = require('../src/agent/ferme');
  const { Vec3 } = require('vec3');
  const plans = plansEnclos(new Vec3(10, 64, 20));
  assert.strictEqual(plans.length, 16);
  assert.strictEqual(plans.filter((b) => b.portillon).length, 1);
  const enclos = { origine: new Vec3(10, 64, 20) };
  assert.ok(dansEnclos(enclos, new Vec3(12.5, 64, 22.5))); // le centre
  assert.ok(!dansEnclos(enclos, new Vec3(10.5, 64, 22.5))); // sur la barrière
});

test('fermier : graines, puis semer, puis barrieres pour l enclos', async () => {
  const { Agent } = require('../src/agent/agent');
  const mc = await import('../src/mindcraft/mcdata.mjs');
  mc.init('1.20.4');
  const a = new Agent(require('../agents.json')[0], { cfg: { agent: { mission: '' } }, gateway: {}, logger: { write() {} } });
  a.recettes = mc.getItemCraftingRecipes;
  a.mcData = require('minecraft-data')('1.20.4');
  const bot = (inv, extra = {}) => ({ ...extra, inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })) } });
  assert.match(a.etapeDuMoment(bot({ wooden_hoe: 1 })), /^collecter short_grass/);
  assert.match(a.etapeDuMoment(bot({ wooden_hoe: 1, wheat_seeds: 8 })), /^semer/);
  assert.match(a.etapeDuMoment(bot({ wooden_hoe: 1 }, { fermeFaite: true })), /^collecter oak_log/); // bois pour les barrières
});

test('demander : la parole formule la demande, pas deux fois la meme en 2 minutes', async () => {
  const { Agent } = require('../src/agent/agent');
  const a = new Agent({ username: 'Joueur6', persona: '' }, { cfg: {}, gateway: {}, logger: {} });
  assert.deepStrictEqual(a.verifierDemande('demander'), []);
  a.memory.demandeEnvoyee = { quoi: '20 pierres pour la maison', t: Date.now() - 30000 };
  assert.match(a.verifierDemande('demander')[0], /déjà demandé/);
  assert.deepStrictEqual(a.verifierDemande('collecter'), []);
});

test('donner et collecter : refuses sans l objet ou sans le bon outil', () => {
  const { checkArgs } = require('../src/agent/actions');
  const registry = require('minecraft-data')('1.20.4');
  const bot = { username: 'Joueur5', registry, players: {}, game: { gameMode: 'survival' }, inventory: { items: () => [{ name: 'stick', type: registry.itemsByName.stick.id }] } };
  assert.match(checkArgs(bot, 'donner', { joueur: 'X', objet: 'cobblestone', quantite: 3 }).join(), /pas de cobblestone/);
  assert.match(checkArgs(bot, 'collecter', { bloc: 'stone' }).join(), /outil/);
  assert.strictEqual(checkArgs(bot, 'collecter', { bloc: 'oak_log' }).length, 0);
  bot.inventory.items = () => [{ name: 'wooden_pickaxe', type: registry.itemsByName.wooden_pickaxe.id }];
  assert.strictEqual(checkArgs(bot, 'collecter', { bloc: 'stone' }).length, 0);
  assert.match(checkArgs(bot, 'collecter', { bloc: 'iron_ore' }).join(), /outil/);
});

test('structure : pave creux, porte creusee par un pave air, couches du bas vers le haut', () => {
  const { plansStructure } = require('../src/agent/construction');
  const { Vec3 } = require('vec3');
  const blocs = plansStructure(new Vec3(10, 64, 10), [
    { bloc: 'stone', de: [0, 0, 0], a: [4, 2, 4], creux: true },
    { bloc: 'air', de: [2, 0, 0], a: [2, 1, 0] },
  ]);
  assert.strictEqual(blocs.length, 75 - 9 - 2); // boîte 5x3x5 sans l'intérieur 3x1x3, moins la porte
  assert.ok(blocs.every((b, i) => i === 0 || blocs[i - 1].pos.y <= b.pos.y));
  assert.ok(!blocs.some((b) => b.pos.x === 12 && b.pos.z === 10 && b.pos.y < 66));
  assert.throws(() => plansStructure(new Vec3(0, 0, 0), [{ bloc: 'stone', de: [0, 0, 0], a: [30, 30, 30] }]), /trop grande/);
});

test('scenario de test : blocs et actions interdits', () => {
  const { Agent } = require('../src/agent/agent');
  const a = new Agent({ username: 'Joueur5', persona: '', interdits: ['_log'], outilsInterdits: ['creuser'] }, { cfg: {}, gateway: {}, logger: {} });
  assert.match(a.verifierInterdits('collecter', { bloc: 'oak_log' })[0], /pas le droit/);
  assert.deepStrictEqual(a.verifierInterdits('collecter', { bloc: 'stone' }), []);
  assert.match(a.verifierInterdits('creuser', {})[0], /pas le droit/);
});

test('sous terre : selon la lumiere du ciel, pas selon la hauteur', () => {
  const { sousTerre } = require('../src/agent/perception');
  const { Vec3 } = require('vec3');
  const bot = (lumiere) => ({ entity: { position: new Vec3(0, -60, 0) }, blockAt: () => ({ skyLight: lumiere }) });
  assert.strictEqual(sousTerre(bot(15)), false); // map plate, en plein air à y = -60
  assert.strictEqual(sousTerre(bot(0)), true);
});

test('pseudos : on parle a un bot par son pseudo ou un surnom, en mot entier', () => {
  const { estCite, citeUnAutre } = require('../src/agent/demandes');
  assert.ok(estCite('tom tes ou ?', ['tomtom59', 'tom']));
  assert.ok(estCite('TOMTOM59 viens', ['tomtom59', 'tom']));
  assert.ok(!estCite('jai trouve des atomes', ['tomtom59', 'tom']));
  assert.ok(citeUnAutre('luna tas du bois ?', 'tomtom59', ['tomtom59', 'Lunaa_44'], { Lunaa_44: ['luna'] }));
  assert.ok(!citeUnAutre('luna tas du bois ?', 'Lunaa_44', ['tomtom59', 'Lunaa_44'], { Lunaa_44: ['luna'] }));
});
