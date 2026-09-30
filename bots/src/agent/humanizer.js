// Delais pour que les bots ne repondent pas instantanement (sinon on les repere trop vite).

function uniform(min, max) {
  return min + Math.random() * (max - min);
}

// Délai total visé avant d'envoyer un message : temps de réaction + temps de frappe.
// Le temps déjà passé à attendre le modèle compte comme temps de réflexion.
function messageDelayMs(text, elapsedMs, cfg) {
  if (!cfg.humanize) return 0;
  const reaction = uniform(cfg.reactionMinMs, cfg.reactionMaxMs);
  const typing = (text.length / cfg.typingCps) * 1000 * uniform(0.8, 1.3);
  return Math.max(0, reaction + typing - elapsedMs);
}

module.exports = { messageDelayMs, uniform };
