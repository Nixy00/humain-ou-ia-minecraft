// Configuration centralisée : tout vient des variables d'environnement (.env),
// aucun secret ni adresse n'est écrit en dur dans le code.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function env(name, def) {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}
function envInt(name, def) {
  const v = parseInt(env(name, ''), 10);
  return Number.isFinite(v) ? v : def;
}
function envFloat(name, def) {
  const v = parseFloat(env(name, ''));
  return Number.isFinite(v) ? v : def;
}
function envBool(name, def) {
  const v = env(name, '');
  if (v === '') return def;
  return ['1', 'true', 'oui', 'yes'].includes(v.toLowerCase());
}

const gameId = env('GAME_ID', `partie-${new Date().toISOString().replace(/[:.]/g, '-')}`);

module.exports = {
  mc: {
    host: env('MC_HOST', 'localhost'),
    port: envInt('MC_PORT', 25565),
    version: env('MC_VERSION', '1.20.4'),
    auth: env('MC_AUTH', 'offline'),
  },
  llm: {
    // Unique point d'entrée : la passerelle LiteLLM (API compatible OpenAI).
    baseUrl: env('LITELLM_BASE_URL', 'http://localhost:4000').replace(/\/+$/, ''),
    apiKey: env('LITELLM_API_KEY', ''),
    model: env('LLM_MODEL', ''),
    // "tools" = function calling ; "json" = repli par réponse JSON dans le texte.
    mode: env('LLM_MODE', 'tools'),
    toolChoice: env('LLM_TOOL_CHOICE', 'auto'),
    temperature: envFloat('LLM_TEMPERATURE', 0.7),
    maxTokens: envInt('LLM_MAX_TOKENS', 400),
    timeoutMs: envInt('LLM_TIMEOUT_MS', 30000),
    maxRetries: envInt('LLM_MAX_RETRIES', 3),
    maxFormatRetries: envInt('LLM_MAX_FORMAT_RETRIES', 2),
    // Limitation du débit, partagée par tous les agents du processus.
    maxConcurrent: envInt('LLM_MAX_CONCURRENT', 1),
    minIntervalMs: envInt('LLM_MIN_INTERVAL_MS', 1500),
    // Limite de tokens pour toute la partie (0 = pas de limite). Au-delà, plus aucun appel au modèle :
    // les bots restent connectés avec leurs réflexes. Sécurité pour une nuit en autonomie.
    budgetTokens: envInt('LLM_BUDGET_TOKENS', 0),
    // Le modèle de la passerelle sait réfléchir avant de répondre ("high" seulement, vide = sans réflexion).
    reasoningEffort: env('LLM_REASONING_EFFORT', ''),
    // Pour quelles têtes (testé : la réflexion de fond invente beaucoup moins avec, la parole n'y gagne presque rien).
    reasoningPour: env('LLM_REASONING_POUR', 'reflexion').split(',').map((k) => k.trim()),
  },
  game: {
    id: gameId,
    logDir: path.resolve(__dirname, '..', env('LOG_DIR', '../data/parties'), gameId),
    agentsFile: path.resolve(__dirname, '..', env('AGENTS_FILE', 'agents.json')),
    // Message serveur qui déclenche une désignation, et commande utilisée pour voter
    // (la même que celle des humains, fournie par le plugin de jeu).
    voteTrigger: new RegExp(env('VOTE_TRIGGER', '\\[DESIGNATION\\]'), 'i'),
    voteCommand: env('VOTE_COMMAND', '/designer {joueur} {nature}'),
  },
  agent: {
    tickMs: envInt('AGENT_TICK_MS', 30000),
    chatDebounceMs: envInt('AGENT_CHAT_DEBOUNCE_MS', 1500),
    actionTimeoutMs: envInt('AGENT_ACTION_TIMEOUT_MS', 60000),
    maxEvents: envInt('AGENT_MAX_EVENTS', 15),
    humanize: envBool('AGENT_HUMANIZE', true),
    // true pour les parties de test entre IA : elles jouent même sans humain connecté.
    sansHumain: envBool('AGENT_SANS_HUMAIN', false),
    joinDelayMaxMs: envInt('AGENT_JOIN_DELAY_MAX_MS', 20000),
    // Port de la vue 3D dans un navigateur (0 = pas de vue).
    vuePort: envInt('AGENT_VUE_PORT', 0),
    // Mission donnée par l'organisateur (tests, en attendant les tâches du plugin). Vide = pas de mission.
    mission: env('AGENT_MISSION', ''),
  },
};
