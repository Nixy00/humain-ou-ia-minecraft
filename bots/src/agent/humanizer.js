// Tout ce qui rend les bots moins "parfaits" : delais, fautes de frappe, coups rates.
// Les chiffres viennent des recherches notees dans le JOURNAL (semaine 40).

function uniform(min, max) {
  return min + Math.random() * (max - min);
}

// Nombre aleatoire autour de `moyenne` (loi normale, methode de Box-Muller).
function gauss(moyenne, ecart) {
  const u = 1 - Math.random();
  const v = Math.random();
  return moyenne + ecart * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Reglages par defaut, chaque bot peut les changer dans agents.json ("style").
const STYLE_DEFAUT = {
  secondesParLettre: 0.25, // vitesse de frappe (0.3 dans l'etude de Jones et Bergen)
  bavard: 0.5, // chance de reagir a un message qui ne lui est pas adresse
  fautes: 0.05, // chance de faire une faute de frappe dans un message
  rateCoup: 0.2, // chance de rater un coup
  accents: 0.2, // chance de garder les accents d'un mot (on les tape rarement dans un chat)
};

// Delai avant d'envoyer un message, d'apres le test de Turing de Jones et Bergen :
// 1 s + temps de frappe + temps de lecture du message recu + temps de reflexion.
// Le temps passe a attendre le LLM compte deja comme reflexion. 12 s maximum.
function messageDelayMs(texte, messageLu, dejaAttenduMs, style) {
  const frappe = texte.length * gauss(style.secondesParLettre, style.secondesParLettre / 10);
  const lecture = messageLu.length * 0.03;
  const reflexion = 0.3 + Math.random() * Math.random() * 3; // souvent court, parfois long
  const total = Math.min((1 + frappe + lecture + reflexion) * 1000, 12000);
  return Math.max(0, total - dejaAttenduMs);
}

// Faute de frappe : on inverse deux lettres d'un mot. Une fois sur deux, on renvoie
// aussi la correction ("*mot") qu'un joueur enverrait juste apres.
function fauteDeFrappe(texte, chance) {
  const mots = texte.split(' ');
  const longs = [];
  mots.forEach((m, i) => {
    if (/^[a-zà-ÿ]{4,}$/i.test(m)) longs.push(i);
  });
  if (Math.random() >= chance || longs.length === 0) return { texte, correction: null };

  const i = longs[Math.floor(Math.random() * longs.length)];
  const mot = mots[i];
  const p = 1 + Math.floor(Math.random() * (mot.length - 2));
  mots[i] = mot.slice(0, p) + mot[p + 1] + mot[p] + mot.slice(p + 2);
  return { texte: mots.join(' '), correction: Math.random() < 0.5 ? '*' + mot : null };
}

// Un joueur qui tape vite ne met pas de majuscule au debut ni de point a la fin.
function ecrireCommeJoueur(texte) {
  // Le modèle écrit parfois l'apostrophe typographique ’ : au clavier on tape '.
  return (texte.charAt(0).toLowerCase() + texte.slice(1)).replace(/\.$/, '').replace(/’/g, "'");
}

// Dans un chat on met rarement les accents : chaque mot accentue garde ses accents
// avec la probabilite `garder` (ex. 0.2), sinon "sérieux" devient "serieux".
function enleverAccents(texte, garder) {
  return texte
    .split(' ')
    .map((mot) => (Math.random() < garder ? mot : mot.normalize('NFD').replace(/[̀-ͯ]/g, '')))
    .join(' ');
}

// Temps de reaction humain : environ 250 ms (plus ou moins 40 ms).
function reactionMs() {
  return Math.max(150, gauss(250, 40));
}

// Petite pause avant une action (le joueur reagit puis se met en route).
function delaiAvantAction() {
  return reactionMs() + uniform(0, 800);
}

// Frapper comme un joueur : visee pas parfaite et parfois un coup dans le vide.
function frapper(bot, mob, rateCoup) {
  const p = mob.position;
  bot.lookAt(p.offset(gauss(0, 0.3), mob.height * 0.8 + gauss(0, 0.15), gauss(0, 0.3))).catch(() => {});
  if (Math.random() < rateCoup) bot.swingArm(); // rate : le bras bouge mais ne touche rien
  else bot.attack(mob);
}

// Temps entre deux coups : irregulier, autour de 0,65 s (recharge de l'attaque depuis la 1.9).
function delaiEntreCoups() {
  return Math.max(300, gauss(650, 150));
}

module.exports = { STYLE_DEFAUT, uniform, gauss, messageDelayMs, fauteDeFrappe, ecrireCommeJoueur, enleverAccents, reactionMs, delaiAvantAction, frapper, delaiEntreCoups };
