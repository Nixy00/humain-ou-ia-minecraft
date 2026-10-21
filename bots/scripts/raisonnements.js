// Affiche le raisonnement des bots pendant une partie : heure, bot, raison du tour, action choisie et "pensée".
// Utilisation : node scripts/raisonnements.js <dossier de la partie> [Joueur5]
const fs = require('fs');
const path = require('path');

const dossier = process.argv[2];
const seulement = process.argv[3];
if (!dossier) {
  console.error('Utilisation : node scripts/raisonnements.js <dossier de la partie> [pseudo]');
  process.exit(1);
}

// decisions.jsonl, ou decisions-Joueur4.jsonl, decisions-Joueur5.jsonl... (un fichier par bot) : on fusionne tout.
const lire = (nom) => {
  const base = nom.replace('.jsonl', '');
  return fs.readdirSync(dossier)
    .filter((f) => f === `${base}.jsonl` || (f.startsWith(`${base}-`) && f.endsWith('.jsonl')))
    .flatMap((f) => fs.readFileSync(path.join(dossier, f), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse))
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));
};

const lignes = [];
for (const d of lire('decisions.jsonl')) {
  if (!d.ok || (seulement && d.agent !== seulement)) continue;
  if (d.kind === 'reflexion') {
    const r = d.args;
    const avis = (r.avis || []).map((x) => `\n           avis sur ${x.joueur} : ${x.avis}`).join('');
    lignes.push([d.ts, `${d.agent} | RÉFLEXION : ${r.resume}\n           intention : ${r.intention}${r.nouvel_objectif ? ` (objectif : ${r.nouvel_objectif})` : ''}${avis}`]);
    continue;
  }
  const dit = d.dire ? `\n           dit : "${d.dire}"` : '';
  lignes.push([d.ts, `${d.agent} | ${d.reason} -> ${d.tool} ${JSON.stringify(d.args)}${dit}${d.pensee ? `\n           pense : ${d.pensee}` : ''}`]);
}
// Les messages des joueurs, pour comprendre à quoi le bot réagit (une seule fois chacun).
const vus = new Set();
for (const e of lire('events.jsonl')) {
  if (e.type !== 'chat' || vus.has(e.ts.slice(0, 19) + e.text)) continue;
  vus.add(e.ts.slice(0, 19) + e.text);
  lignes.push([e.ts, `   <${e.from}> ${e.text}`]);
}
lignes.sort((a, b) => (a[0] < b[0] ? -1 : 1));
for (const [ts, texte] of lignes) console.log(ts.slice(11, 19), texte);
