// Lanceur : démarre les agents décrits dans agents.json.
// Usage : npm start            -> tous les agents dans un seul programme
//         npm start -- Joueur4 -> seulement les agents nommés
// En partie, chaque bot a son propre programme (lancer.sh) : il ne fait pas attendre les autres
// quand il calcule un chemin, il a sa propre file d'appels au modèle, et s'il plante il est seul à tomber.
// Plusieurs agents sans humains = mode de parties automatiques (tests).

const fs = require('fs');
const path = require('path');
const cfg = require('./src/config');
const { Gateway } = require('./src/llm/gateway');
const { JsonlLogger } = require('./src/observability/logger');
const { Agent } = require('./src/agent/agent');
const { uniform } = require('./src/agent/humanizer');

const profiles = JSON.parse(fs.readFileSync(cfg.game.agentsFile, 'utf8'));
// Scénario de test : il remplace l'objectif d'équipe et complète chaque profil (mission, objectifs, interdits).
if (cfg.agent.test) {
  const test = JSON.parse(fs.readFileSync(path.resolve(__dirname, cfg.agent.test), 'utf8'));
  cfg.agent.equipe = test.equipe || '';
  profiles.forEach((p) => Object.assign(p, test.bots[p.username]));
}
const only = process.argv.slice(2);
const selected = only.length ? profiles.filter((p) => only.includes(p.username)) : profiles;
if (selected.length === 0) {
  console.error('Aucun agent à lancer (vérifier agents.json et les noms passés en argument).');
  process.exit(1);
}

// Un seul bot dans ce programme : ses journaux portent son nom (plusieurs programmes écrivent dans le même dossier).
const logger = new JsonlLogger(cfg.game.logDir, cfg.game.id, selected.length === 1 ? selected[0].username : '');
const gateway = new Gateway(cfg.llm); // le limiteur de débit vaut pour les agents de ce programme
logger.write('events', {
  type: 'lancement',
  agents: selected.map((p) => p.username),
  model: cfg.llm.model,
  mode: cfg.llm.mode,
  humanize: cfg.agent.humanize,
  archetypes: selected.map((p) => `${p.username} : ${p.archetype}`),
});
console.log(`Partie ${cfg.game.id} : journaux dans ${cfg.game.logDir}`);

// Liste de tous les agents : sert à savoir si un humain est connecté.
cfg.game.agents = profiles.map((p) => p.username);
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
