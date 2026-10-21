// Enregistre la partie dans des fichiers .jsonl (une ligne JSON par evenement).
// Un fichier par type : llm_calls, decisions, actions, events, votes, notes, errors.
// Quand chaque bot tourne dans son propre programme, on ajoute son nom au fichier (actions-Joueur4.jsonl) :
// trois programmes qui écrivent dans le même fichier pourraient mélanger leurs lignes.

const fs = require('fs');
const path = require('path');

class JsonlLogger {
  constructor(dir, gameId, suffixe = '') {
    this.dir = dir;
    this.gameId = gameId;
    this.suffixe = suffixe ? `-${suffixe}` : '';
    this.streams = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  write(stream, record) {
    let s = this.streams.get(stream);
    if (!s) {
      s = fs.createWriteStream(path.join(this.dir, `${stream}${this.suffixe}.jsonl`), { flags: 'a' });
      this.streams.set(stream, s);
    }
    s.write(JSON.stringify({ ts: new Date().toISOString(), game_id: this.gameId, ...record }) + '\n');
  }

  close() {
    return Promise.all([...this.streams.values()].map((s) => new Promise((r) => s.end(r))));
  }
}

module.exports = { JsonlLogger };
