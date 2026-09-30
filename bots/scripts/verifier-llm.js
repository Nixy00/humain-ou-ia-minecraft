// Test de la semaine 1 : est-ce que le modele repond bien avec un outil / en JSON ?
// Usage : npm run verifier-llm -- 20

const cfg = require('../src/config');
const { Gateway } = require('../src/llm/gateway');
const { JsonlLogger } = require('../src/observability/logger');
const { callTool } = require('../src/llm/structured');
const { TOOLS } = require('../src/agent/actions');
const { systemPrompt, turnPrompt } = require('../src/agent/prompt');

const N = parseInt(process.argv[2], 10) || 10;

const OBSERVATION = `Toi : Joueur4. Vie 20/20, faim 17/20. Position x=12 y=64 z=-40. Il fait jour.
Inventaire : oak_log x3, dirt x5.
Joueurs connectés : Joueur1, Joueur2.
Joueurs visibles : Joueur1 à 6 blocs.
Monstres proches : aucun.
Blocs utiles autour : oak_log (14, le plus proche à 5 blocs), stone (40, le plus proche à 3 blocs).

Derniers évènements (du plus ancien au plus récent) :
- [serveur, il y a 40 s] Tâche : fabriquer 4 crafting_table et les livrer à Joueur2.
- [chat, il y a 3 s] <Joueur1> qqn a du bois ? je te file de la cobble contre

Tes dernières actions :
- aucune`;

async function run(mode) {
  const gateway = new Gateway({ ...cfg.llm, maxFormatRetries: 0 });
  gateway.mode = mode;
  const logger = new JsonlLogger(cfg.game.logDir.replace(cfg.game.id, `verification-${cfg.game.id}`), 'verification');
  const stats = { mode, essais: N, valides_1er_coup: 0, valides_avec_relance: 0, latences: [], outils: {} };

  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const common = {
      gateway,
      logger,
      messages: [
        { role: 'system', content: systemPrompt('Joueur4', 'Tu joues de façon détendue.') },
        { role: 'user', content: turnPrompt(OBSERVATION, 'message de Joueur1') },
      ],
      tools: TOOLS,
      meta: { agent: 'verification', decisionId: `${mode}-${i}`, kind: 'verification' },
    };
    const first = await callTool({ ...common, maxFormatRetries: 0 });
    if (first) {
      stats.valides_1er_coup++;
      stats.valides_avec_relance++;
      stats.outils[first.name] = (stats.outils[first.name] ?? 0) + 1;
    } else {
      const retry = await callTool({ ...common, maxFormatRetries: 2 });
      if (retry) stats.valides_avec_relance++;
    }
    stats.latences.push(Date.now() - t0);
    process.stdout.write('.');
  }
  await logger.close();
  if (gateway.mode !== mode) stats.remarque = `le serveur a refusé le mode ${mode} (bascule en ${gateway.mode})`;
  const sorted = [...stats.latences].sort((a, b) => a - b);
  stats.latence_mediane_ms = sorted[Math.floor(sorted.length / 2)];
  stats.latence_max_ms = sorted[sorted.length - 1];
  delete stats.latences;
  return stats;
}

(async () => {
  console.log(`Modèle : ${cfg.llm.model} via ${cfg.llm.baseUrl}, ${N} essais par mode`);
  for (const mode of ['tools', 'json']) {
    const s = await run(mode);
    console.log(`\n${JSON.stringify(s, null, 2)}`);
  }
  console.log('Détail des appels : dossier verification-* dans LOG_DIR (llm_calls.jsonl).');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
