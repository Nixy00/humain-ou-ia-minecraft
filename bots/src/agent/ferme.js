// La ferme (rôle de Joueur4) : semer du blé, le récolter, faire un enclos et y attirer des animaux,
// comme un joueur : un animal suit celui qui tient sa nourriture en main (blé pour vaches et moutons...).
// Ce que chaque animal suit quand on le tient en main (règle du jeu).
const NOURRITURE_ANIMAL = {
  cow: ['wheat'],
  sheep: ['wheat'],
  pig: ['carrot', 'potato', 'beetroot'],
  chicken: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'],
};

// Enclos de 5 x 5 : le tour (16 cases), avec un portillon au milieu du côté nord.
function plansEnclos(origine) {
  const blocs = [];
  for (let dx = 0; dx < 5; dx++) {
    for (let dz = 0; dz < 5; dz++) {
      if (dx === 0 || dz === 0 || dx === 4 || dz === 4) blocs.push({ pos: origine.offset(dx, 0, dz), portillon: dz === 0 && dx === 2 });
    }
  }
  return blocs;
}

// L'intérieur de l'enclos : les cases de 1 à 3 en x et en z.
function dansEnclos(enclos, pos) {
  const o = enclos.origine;
  return pos.x >= o.x + 1 && pos.x < o.x + 4 && pos.z >= o.z + 1 && pos.z < o.z + 4;
}

// Le blé mûr (âge 7) autour du bot : on ne casse pas le blé qui n'a pas fini de pousser.
function bleMur(bot) {
  return bot.findBlocks({ matching: bot.registry.blocksByName.wheat.id, maxDistance: 16, count: 64 })
    .filter((p) => {
      const b = bot.blockAt(p);
      return b && b.getProperties().age === 7;
    });
}

// Des cases de terre ou d'herbe libres près du bot, de la plus proche à la plus loin.
function terreASemer(bot, n) {
  const p = bot.entity.position.floored();
  const cases = [];
  for (let r = 1; r <= 6 && cases.length < n; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || cases.length >= n) continue;
        for (const dy of [-1, -2, 0]) {
          const sol = bot.blockAt(p.offset(dx, dy, dz));
          const dessus = bot.blockAt(p.offset(dx, dy + 1, dz));
          if (sol && ['grass_block', 'dirt'].includes(sol.name) && dessus && dessus.boundingBox === 'empty' && !dessus.name.includes('water')) {
            cases.push(sol.position);
            break;
          }
        }
      }
    }
  }
  return cases;
}

module.exports = { NOURRITURE_ANIMAL, plansEnclos, dansEnclos, bleMur, terreASemer };
