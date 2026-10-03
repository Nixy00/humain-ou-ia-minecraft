// Reflexes : petites reactions automatiques sans passer par le LLM (il met plusieurs secondes a repondre).
// Idee reprise des "modes" de Mindcraft.

const { isHostile } = require('./perception');
const { uniform, reactionMs, frapper, delaiEntreCoups } = require('./humanizer');

// actionEnCours() : nom de l'action que le bot execute, ou null s'il n'en fait pas.
function startReflexes(bot, style, actionEnCours, onReflexe) {
  let derniereCible = null;
  let prochainCoup = 0;
  let sauteDansEau = false;
  let anciennePos = null;
  let immobileDepuis = Date.now();
  let prochainRegard = Date.now() + 5000;

  function reagir() {
    if (!bot.entity) return;
    const pos = bot.entity.position;
    const maintenant = Date.now();

    // 1. Ne pas se noyer : sauter quand la tete est dans l'eau (si on ne marche pas deja).
    const tete = bot.blockAt(pos.offset(0, 1, 0));
    // Boolean() : apres une mort le bloc n'est pas encore charge (null), et setControlState plante si ce n'est pas un vrai/faux.
    const dansEau = Boolean(tete && tete.name === 'water' && !bot.pathfinder.isMoving());
    if (dansEau !== sauteDansEau) {
      bot.setControlState('jump', dansEau);
      sauteDansEau = dansEau;
    }

    // 2. Auto-defense : un monstre a moins de 4 blocs, on le frappe.
    // Comme un joueur : un temps de reaction, un rythme irregulier et des coups rates.
    const mob = bot.nearestEntity((e) => isHostile(e) && pos.distanceTo(e.position) < 4);
    if (mob && mob !== derniereCible) {
      derniereCible = mob;
      prochainCoup = maintenant + reactionMs();
      onReflexe('auto_defense', mob.name);
    }
    const action = actionEnCours();
    if (mob && action !== 'se_defendre' && maintenant >= prochainCoup) {
      frapper(bot, mob, style.rateCoup);
      prochainCoup = maintenant + delaiEntreCoups();
    }

    // 3. Bloque : le bot essaie de marcher mais n'a pas bouge d'un bloc en 10 s.
    // On arrete le deplacement : l'action echoue et le LLM choisit autre chose.
    if (bot.pathfinder.isMoving()) {
      if (!anciennePos || pos.distanceTo(anciennePos) > 1) {
        anciennePos = pos.clone();
        immobileDepuis = maintenant;
      } else if (maintenant - immobileDepuis > 10000) {
        bot.pathfinder.setGoal(null);
        onReflexe('debloquer', `bloque en ${Math.round(pos.x)} ${Math.round(pos.y)} ${Math.round(pos.z)}`);
        immobileDepuis = maintenant;
      }
    } else {
      anciennePos = null;
    }

    // 4. Quand il ne fait rien, il regarde autour de lui de temps en temps
    // (un joueur proche, ou juste un petit coup d'oeil), comme un humain qui attend.
    if (!mob && !action && !bot.pathfinder.isMoving() && maintenant > prochainRegard) {
      const joueur = bot.nearestEntity((e) => e.type === 'player' && pos.distanceTo(e.position) < 16);
      if (joueur && Math.random() < 0.5) {
        bot.lookAt(joueur.position.offset(0, joueur.height, 0)).catch(() => {});
      } else {
        bot.look(bot.entity.yaw + uniform(-0.6, 0.6), uniform(-0.3, 0.2)).catch(() => {});
      }
      prochainRegard = maintenant + uniform(3000, 9000);
    }
  }

  // Une erreur dans un reflexe ne doit pas faire planter tout le programme (et les autres bots avec).
  return setInterval(() => {
    try {
      reagir();
    } catch (err) {
      onReflexe('erreur', err.message);
    }
  }, 100);
}

module.exports = { startReflexes };
