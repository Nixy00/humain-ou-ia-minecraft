// Reflexes : petites reactions automatiques sans passer par le LLM (il met plusieurs secondes a repondre).
// Idee reprise des "modes" de Mindcraft.

const { isHostile } = require('./perception');

function startReflexes(bot, onReflexe) {
  let dernierCoup = 0;
  let derniereCible = null;
  let sauteDansEau = false;
  let anciennePos = null;
  let immobileDepuis = Date.now();

  return setInterval(() => {
    if (!bot.entity) return;
    const pos = bot.entity.position;

    // 1. Ne pas se noyer : sauter quand la tête est dans l'eau (si on ne marche pas déjà).
    const tete = bot.blockAt(pos.offset(0, 1, 0));
    const dansEau = tete && tete.name === 'water' && !bot.pathfinder.isMoving();
    if (dansEau !== sauteDansEau) {
      bot.setControlState('jump', dansEau);
      sauteDansEau = dansEau;
    }

    // 2. Auto-défense : un monstre à moins de 4 blocs, on le frappe (cadence d'un joueur).
    const mob = bot.nearestEntity((e) => isHostile(e) && pos.distanceTo(e.position) < 4);
    if (mob && Date.now() - dernierCoup > 650) {
      bot.lookAt(mob.position.offset(0, mob.height * 0.8, 0)).catch(() => {});
      bot.attack(mob);
      dernierCoup = Date.now();
      if (mob !== derniereCible) onReflexe('auto_defense', mob.name);
      derniereCible = mob;
    }

    // 3. Bloqué : le bot essaie de marcher mais n'a pas bougé d'un bloc en 10 s.
    // On arrête le déplacement : l'action échoue et le LLM choisit autre chose.
    if (bot.pathfinder.isMoving()) {
      if (!anciennePos || pos.distanceTo(anciennePos) > 1) {
        anciennePos = pos.clone();
        immobileDepuis = Date.now();
      } else if (Date.now() - immobileDepuis > 10000) {
        bot.pathfinder.stop();
        onReflexe('debloquer', `bloqué en ${Math.round(pos.x)} ${Math.round(pos.y)} ${Math.round(pos.z)}`);
        immobileDepuis = Date.now();
      }
    } else {
      anciennePos = null;
    }
  }, 500);
}

module.exports = { startReflexes };
