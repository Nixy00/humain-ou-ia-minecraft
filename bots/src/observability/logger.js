// Enregistre la partie dans des fichiers .jsonl (une ligne JSON par evenement).
// Un fichier par type : llm_calls, decisions, actions, events, votes, notes, errors.

const fs = require('fs');
const path = require('path');

class JsonlLogger {
  constructor(dir, gameId) {
    this.dir = dir;
    this.gameId = gameId;
    this.streams = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  write(stream, record) {
    let s = this.streams.get(stream);
    if (!s) {
      s = fs.createWriteStream(path.join(this.dir, `${stream}.jsonl`), { flags: 'a' });
      this.streams.set(stream, s);
    }
    s.write(JSON.stringify({ ts: new Date().toISOString(), game_id: this.gameId, ...record }) + '\n');
  }

  close() {
    return Promise.all([...this.streams.values()].map((s) => new Promise((r) => s.end(r))));
  }
}

module.exports = { JsonlLogger };
