// Construction d'une cabane simple, calculée par le code : le modèle dit juste "construire",
// il ne sait pas placer 70 blocs un par un avec des coordonnées (trop long et il se trompe).
const { Vec3 } = require('vec3');

const TAILLE = 5; // cabane de 5 x 5, intérieur de 3 x 3
const HAUTEUR = 3; // murs de 3 blocs, puis le toit
const VIDES = ['air', 'cave_air', 'grass', 'short_grass', 'tall_grass', 'fern', 'snow', 'dead_bush'];

// Liste des blocs à poser, dans l'ordre : les murs rangée par rangée (en partant du bas),
// puis le toit du bord vers le centre (chaque bloc du toit doit toucher un bloc déjà posé).
function plansCabane(origine) {
  const blocs = [];
  for (let dy = 0; dy < HAUTEUR; dy++) {
    for (let dx = 0; dx < TAILLE; dx++) {
      for (let dz = 0; dz < TAILLE; dz++) {
        const bord = dx === 0 || dz === 0 || dx === TAILLE - 1 || dz === TAILLE - 1;
        const porte = dz === 0 && dx === 2 && dy < 2; // ouverture de 2 blocs de haut au milieu d'un mur
        if (bord && !porte) blocs.push({ pos: origine.offset(dx, dy, dz), partie: 'mur' });
      }
    }
  }
  const toit = [];
  for (let dx = 0; dx < TAILLE; dx++) {
    for (let dz = 0; dz < TAILLE; dz++) {
      const versCentre = Math.max(Math.abs(dx - 2), Math.abs(dz - 2)); // 2 = bord, 0 = centre
      toit.push({ pos: origine.offset(dx, HAUTEUR, dz), partie: 'toit', versCentre });
    }
  }
  toit.sort((a, b) => b.versCentre - a.versCentre);
  return blocs.concat(toit.map(({ pos, partie }) => ({ pos, partie })));
}

function vide(bot, pos) {
  const b = bot.blockAt(pos);
  return Boolean(b) && VIDES.includes(b.name);
}

// Un endroit plat et dégagé de 5 x 5 près du bot (pas sur lui, pour ne pas s'emmurer).
function trouverTerrain(bot) {
  const p = bot.entity.position.floored();
  for (let r = 2; r <= 12; r++) {
    for (const [dx, dz] of [[r, 0], [-r - TAILLE + 1, 0], [0, r], [0, -r - TAILLE + 1]]) {
      const origine = p.offset(dx, 0, dz);
      let ok = true;
      for (let x = 0; x < TAILLE && ok; x++) {
        for (let z = 0; z < TAILLE && ok; z++) {
          const sol = bot.blockAt(origine.offset(x, -1, z));
          if (!sol || VIDES.includes(sol.name) || sol.name.includes('water') || sol.name.includes('leaves')) ok = false;
          for (let y = 0; y <= HAUTEUR && ok; y++) if (!vide(bot, origine.offset(x, y, z))) ok = false;
        }
      }
      if (ok) return origine;
    }
  }
  return null;
}

// Les murs en pierre si possible, le toit en planches (sinon ce qu'il reste).
function choisirBloc(bot, partie) {
  const items = bot.inventory.items();
  const planches = items.find((i) => i.name.endsWith('_planks'));
  const pierre = items.find((i) => i.name === 'cobblestone');
  return partie === 'mur' ? (pierre || planches) : (planches || pierre);
}

const NB_BLOCS = plansCabane(new Vec3(0, 0, 0)).length;

module.exports = { plansCabane, trouverTerrain, choisirBloc, vide, NB_BLOCS };
