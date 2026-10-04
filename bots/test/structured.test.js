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
  const bot = { username: 'Joueur4', players: { Joueur1: {} } };
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


test('collecter de la cobble = miner de la pierre', () => {
  const { resolveBlocks } = require('../src/agent/actions');
  const mcData = require('minecraft-data')('1.20.4');
  assert.deepStrictEqual(resolveBlocks(mcData, 'cobblestone'), [mcData.blocksByName.stone.id]);
});

test('répétition : un message qui commence comme un des derniers est refusé', () => {
  const { Agent } = require('../src/agent/agent');
  const a = new Agent({ username: 'Joueur4', persona: '' }, { cfg: {}, gateway: {}, logger: {} });
  a.memory.actions.push({ name: 'parler', args: { message: "mdr t'es où gros ?" } });
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
  a.memory.actions.push({ name: 'parler', args: { message: "wsh t'es ou frr ?" } });
  assert.strictEqual(a.verifierRepetition('parler', { message: "wsh t'es ou jte vois pas mdr" }).length, 1);
});

test('une demande de joueur n\'est pas écrasée par la minuterie', () => {
  const { Agent } = require('../src/agent/agent');
  const a = new Agent({ username: 'Joueur4', persona: '' }, { cfg: {}, gateway: {}, logger: {} });
  a.mcData = {};
  a.busy = true; // le bot est occupé par une action
  a.schedule('message de SAHYGO', 0);
  a.schedule('minuterie (rien ne s\'est passé récemment)', 0);
  assert.strictEqual(a.pendingReason, 'message de SAHYGO');
  a.busy = false; // pas occupé : la décision est prévue dans 1,5 s
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
