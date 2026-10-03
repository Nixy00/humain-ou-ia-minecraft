// Lanceur : démarre les agents décrits dans agents.json.
// Usage : npm start            -> tous les agents
//         npm start -- Joueur4 -> seulement les agents nommés
// Plusieurs agents sans humains = mode de parties automatiques (tests).

const fs = require('fs');
const cfg = require('./src/config');
const { Gateway } = require('./src/llm/gateway');
const { JsonlLogger } = require('./src/observability/logger');
const { Agent } = require('./src/agent/agent');
const { uniform } = require('./src/agent/humanizer');

const profiles = JSON.parse(fs.readFileSync(cfg.game.agentsFile, 'utf8'));
const only = process.argv.slice(2);
const selected = only.length ? profiles.filter((p) => only.includes(p.username)) : profiles;
if (selected.length === 0) {
  console.error('Aucun agent à lancer (vérifier agents.json et les noms passés en argument).');
  process.exit(1);
}

const logger = new JsonlLogger(cfg.game.logDir, cfg.game.id);
const gateway = new Gateway(cfg.llm); // partagée : le limiteur de débit vaut pour tous les agents
logger.write('events', {
  type: 'lancement',
  agents: selected.map((p) => p.username),
  model: cfg.llm.model,
  mode: cfg.llm.mode,
  humanize: cfg.agent.humanize,
  archetypes: selected.map((p) => `${p.username} : ${p.archetype}`),
});
console.log(`Partie ${cfg.game.id} : journaux dans ${cfg.game.logDir}`);

const agents = selected.map((p) => new Agent(p, { cfg, gateway, logger }));
// Arrivées étalées : des connexions simultanées trahiraient les agents.
agents.forEach((a, i) => setTimeout(() => a.start(), i === 0 ? 0 : uniform(2000, cfg.agent.joinDelayMaxMs)));

async function shutdown() {
  console.log('Arrêt des agents...');
  agents.forEach((a) => a.stop());
  await logger.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
