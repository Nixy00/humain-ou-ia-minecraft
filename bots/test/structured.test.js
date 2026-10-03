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

test('paquet de recul : la vitesse est recopiée sous les anciens noms (sinon NaN et expulsion)', () => {
  const { EventEmitter } = require('events');
  const { corrigerPaquetsVitesse } = require('../src/agent/agent');
  const client = new EventEmitter();
  corrigerPaquetsVitesse(client);
  let lu;
  client.on('entity_velocity', (p) => { lu = [p.velocityX, p.velocityY, p.velocityZ]; });
  client.emit('entity_velocity', { entityId: 1, velocity: { x: 100, y: 200, z: -50 } });
  assert.deepStrictEqual(lu, [100, 200, -50]);
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
