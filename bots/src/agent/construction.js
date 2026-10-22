// Construction d'une cabane simple, calculée par le code : le modèle dit juste "construire",
// il ne sait pas placer 70 blocs un par un avec des coordonnées (trop long et il se trompe).
const fs = require('fs');
const path = require('path');
const { Vec3 } = require('vec3');

const TAILLE = 5; // cabane de 5 x 5, intérieur de 3 x 3
const HAUTEUR = 3; // murs de 3 blocs, puis le toit

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

// Vide = on peut poser à cet endroit : air, herbe, fleurs... (blocs qu'on traverse).
function vide(bot, pos) {
  const b = bot.blockAt(pos);
  return Boolean(b) && b.boundingBox === 'empty' && !b.name.includes('water') && !b.name.includes('lava');
}

function solide(bot, pos) {
  const b = bot.blockAt(pos);
  return Boolean(b) && b.boundingBox === 'block' && !b.name.includes('leaves');
}

// Un terrain de 5 x 5 dégagé près du bot, pas sur lui (pour ne pas s'emmurer).
// Le sol peut avoir un creux d'un bloc : autour du spawn c'est montagneux et rien n'est parfaitement plat.
function terrainOk(bot, origine) {
  for (let x = 0; x < TAILLE; x++) {
    for (let z = 0; z < TAILLE; z++) {
      const sol = origine.offset(x, -1, z);
      if (!solide(bot, sol) && !(vide(bot, sol) && solide(bot, sol.offset(0, -1, 0)))) return false;
      for (let y = 0; y <= HAUTEUR; y++) if (!vide(bot, origine.offset(x, y, z))) return false;
    }
  }
  return true;
}

function trouverTerrain(bot) {
  const p = bot.entity.position.floored();
  const essais = [];
  for (let dx = -14; dx <= 10; dx++) {
    for (let dz = -14; dz <= 10; dz++) {
      const surLui = dx <= 0 && dx > -TAILLE && dz <= 0 && dz > -TAILLE;
      if (!surLui) essais.push([dx, dz, Math.abs(dx + 2) + Math.abs(dz + 2)]);
    }
  }
  essais.sort((a, b) => a[2] - b[2]); // les plus proches d'abord
  for (const [dx, dz] of essais) {
    for (const dy of [0, -1, 1, -2, 2]) {
      const origine = p.offset(dx, dy, dz);
      if (terrainOk(bot, origine)) return origine;
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

// Structure inventée par le modèle : une liste de pavés { bloc, de: [x, y, z], a: [x, y, z], creux }.
// Les pavés sont appliqués dans l'ordre : un pavé "air" plus loin creuse une porte ou des fenêtres.
// Renvoie les blocs à poser, couche par couche, et du bord vers le centre dans chaque couche (comme le toit de la cabane).
const MAX_BLOCS = 800;
function plansStructure(origine, paves) {
  const cases = new Map();
  for (const p of paves) {
    const [x1, y1, z1] = p.de.map((v) => Math.max(0, Math.min(30, Math.round(v))));
    const [x2, y2, z2] = p.a.map((v) => Math.max(0, Math.min(30, Math.round(v))));
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
          const bord = [x === x1 || x === x2, y === y1 || y === y2, z === z1 || z === z2].filter(Boolean).length;
          if (p.creux && bord === 0) continue; // creux : seulement les faces du pavé
          cases.set(`${x},${y},${z}`, { x, y, z, bloc: p.bloc });
        }
      }
    }
  }
  const blocs = [...cases.values()].filter((c) => c.bloc !== 'air');
  if (blocs.length > MAX_BLOCS) throw new Error(`structure trop grande (${blocs.length} blocs, ${MAX_BLOCS} au plus)`);
  const cx = blocs.reduce((s, c) => s + c.x, 0) / (blocs.length || 1);
  const cz = blocs.reduce((s, c) => s + c.z, 0) / (blocs.length || 1);
  const loin = (c) => Math.max(Math.abs(c.x - cx), Math.abs(c.z - cz));
  blocs.sort((a, b) => a.y - b.y || loin(b) - loin(a));
  return blocs.map((c) => ({ pos: origine.offset(c.x, c.y, c.z), bloc: c.bloc }));
}

// Bibliothèque de structures : chaque plan construit est gardé dans un fichier, pour le refaire plus tard.
const DOSSIER = path.join(__dirname, '..', '..', 'structures');
const nomFichier = (nom) => path.join(DOSSIER, `${String(nom).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_')}.json`);

function sauverStructure(nom, paves, auteur) {
  fs.mkdirSync(DOSSIER, { recursive: true });
  fs.writeFileSync(nomFichier(nom), JSON.stringify({ nom, auteur, date: new Date().toISOString(), paves }, null, 1));
}

function chargerStructure(nom) {
  try {
    return JSON.parse(fs.readFileSync(nomFichier(nom), 'utf8')).paves;
  } catch {
    return null;
  }
}

function listeStructures() {
  try {
    return fs.readdirSync(DOSSIER).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

module.exports = { plansCabane, trouverTerrain, choisirBloc, vide, NB_BLOCS, plansStructure, sauverStructure, chargerStructure, listeStructures };
