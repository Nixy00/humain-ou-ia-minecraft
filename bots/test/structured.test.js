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
});
