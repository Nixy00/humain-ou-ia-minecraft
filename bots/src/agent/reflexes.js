// Reflexes : petites reactions automatiques sans passer par le LLM (il met plusieurs secondes a repondre).
// Idee reprise des "modes" de Mindcraft.

const { goals } = require('mineflayer-pathfinder');
const { isHostile } = require('./perception');
const { uniform, reactionMs, frapper, delaiEntreCoups } = require('./humanizer');

// Nourriture qui empoisonne : on ne la mange jamais automatiquement.
const MAUVAISE_BOUFFE = ['spider_eye', 'poisonous_potato', 'pufferfish', 'suspicious_stew'];

// actionEnCours() : nom de l'action que le bot execute, ou null s'il n'en fait pas.
function startReflexes(bot, style, actionEnCours, onReflexe) {
  let derniereCible = null;
  let prochainCoup = 0;
  let sauteDansEau = false;
  let anciennePos = null;
  let immobileDepuis = Date.now();
  let prochainRegard = Date.now() + 5000;
  let enFuite = 0; // heure du debut de la fuite, 0 si on ne fuit pas
  let enTrainDeManger = false;

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

    // Survie (idee des modes "self_preservation" de Mindcraft). Le bot mourait en boucle (34 fois en 20 min).
    // a) Fuir : vie basse et un monstre pas loin -> on s'eloigne au lieu de se battre (8 s maximum).
    const danger = bot.nearestEntity((e) => isHostile(e) && pos.distanceTo(e.position) < 10);
    if (!enFuite && bot.health <= 6 && danger) {
      enFuite = maintenant;
      bot.interrompre = true; // arrete l'action en cours
      bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalFollow(danger, 16)), true);
      onReflexe('fuite', `${danger.name}, vie ${Math.round(bot.health)}`);
    } else if (enFuite && (!danger || maintenant - enFuite > 8000)) {
      bot.pathfinder.setGoal(null);
      enFuite = 0;
    }
    // b) Manger tout seul : faim <= 14 quand il ne fait rien, ou faim <= 6 meme pendant une action.
    if (!enTrainDeManger && !enFuite && !danger && bot.food <= 14 && (!actionEnCours() || bot.food <= 6)) {
      const nourriture = bot.inventory.items().find((i) => bot.registry.foodsByName[i.name] && !MAUVAISE_BOUFFE.includes(i.name) && (i.name !== 'rotten_flesh' || bot.food <= 6));
      if (nourriture) {
        enTrainDeManger = true;
        bot.equip(nourriture, 'hand')
          .then(() => bot.consume())
          .then(() => onReflexe('manger', nourriture.name))
          .catch(() => {})
          .finally(() => { enTrainDeManger = false; });
      }
    }

    // 2. Auto-defense : un monstre a moins de 4 blocs, on le frappe (sauf s'il est en train de fuir).
    // Comme un joueur : un temps de reaction, un rythme irregulier et des coups rates.
    const mob = enFuite ? null : bot.nearestEntity((e) => isHostile(e) && pos.distanceTo(e.position) < 4);
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
