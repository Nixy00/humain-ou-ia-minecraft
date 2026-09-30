// Un agent = un bot Mineflayer controle par le LLM.
// Boucle : on regarde la situation -> on demande au LLM -> on fait l'action.

const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const minecraftData = require('minecraft-data');

const { observe } = require('./perception');
const { TOOLS, execute, checkArgs } = require('./actions');
const { systemPrompt, turnPrompt, votePrompt } = require('./prompt');
const { messageDelayMs, uniform } = require('./humanizer');
const { callTool } = require('../llm/structured');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Agent {
  constructor({ username, persona }, { cfg, gateway, logger }) {
    this.username = username;
    this.persona = persona;
    this.cfg = cfg;
    this.gateway = gateway;
    this.logger = logger;
    this.memory = { events: [], actions: [], objectif: null };
    this.seq = 0;
    this.busy = false;
    this.pendingReason = null;
    this.stopping = false;
    this.reconnectDelay = 5000;
  }

  log(msg) {
    console.log(`[${this.username}] ${msg}`);
  }

  start() {
    const bot = mineflayer.createBot({
      host: this.cfg.mc.host,
      port: this.cfg.mc.port,
      username: this.username,
      version: this.cfg.mc.version,
      auth: this.cfg.mc.auth,
    });
    this.bot = bot;
    bot.loadPlugin(pathfinder);

    bot.once('spawn', () => {
      this.reconnectDelay = 5000;
      this.mcData = minecraftData(bot.version);
      const moves = new Movements(bot);
      moves.canDig = false; // on ne casse pas de blocs pour se déplacer (constructions des autres)
      bot.pathfinder.setMovements(moves);
      this.log('connecté');
      this.logger.write('events', { agent: this.username, type: 'connexion' });
      this.tickTimer = setInterval(() => this.schedule('minuterie (rien ne s\'est passé récemment)', 0), this.cfg.agent.tickMs);
      this.schedule('tu viens de te connecter', uniform(3000, 8000));
    });

    bot.on('chat', (from, text) => {
      if (from === this.username) return;
      this.onEvent({ type: 'chat', from, text }, `message de ${from}`);
    });
    bot.on('whisper', (from, text) => {
      if (from === this.username) return;
      this.onEvent({ type: 'whisper', from, text }, `message privé de ${from}`);
    });
    // Messages du serveur (tâches, désignations, arrivées...) : hors chat des joueurs.
    bot.on('messagestr', (text, position) => {
      if (position !== 'system' || !text.trim()) return;
      if (this.cfg.game.voteTrigger.test(text)) {
        this.onEvent({ type: 'serveur', text }, null);
        this.vote(text);
        return;
      }
      this.onEvent({ type: 'serveur', text }, 'message du serveur');
    });
    bot.on('death', () => this.onEvent({ type: 'mort', text: 'tu es mort et tu as réapparu' }, 'tu viens de mourir'));
    bot.on('kicked', (reason) => this.logger.write('errors', { agent: this.username, message: 'expulsé', detail: String(reason) }));
    bot.on('error', (err) => this.logger.write('errors', { agent: this.username, message: 'erreur client', detail: err.message }));
    bot.on('end', (reason) => this.onEnd(reason));
  }

  onEvent(event, reason) {
    const e = { ...event, t: Date.now() };
    this.memory.events.push(e);
    if (this.memory.events.length > this.cfg.agent.maxEvents) this.memory.events.shift();
    this.logger.write('events', { agent: this.username, ...event });
    if (reason) this.schedule(reason, this.cfg.agent.chatDebounceMs);
  }

  // Regroupe les évènements rapprochés : une seule décision après `delayMs` de calme.
  schedule(reason, delayMs) {
    if (!this.mcData) return;
    if (this.busy) {
      this.pendingReason = reason;
      return;
    }
    clearTimeout(this.decideTimer);
    this.decideTimer = setTimeout(() => this.decide(reason), delayMs);
  }

  async decide(reason) {
    if (this.busy || this.stopping || !this.bot?.entity) return;
    this.busy = true;
    const decisionId = `${this.username}-${++this.seq}`;
    const t0 = Date.now();
    try {
      const observation = observe(this.bot, this.mcData, this.memory);
      const choice = await callTool({
        gateway: this.gateway,
        logger: this.logger,
        messages: [
          { role: 'system', content: systemPrompt(this.username, this.persona) },
          { role: 'user', content: turnPrompt(observation, reason) },
        ],
        tools: TOOLS,
        meta: { agent: this.username, decisionId, kind: 'decision' },
        extraCheck: (name, args) => checkArgs(this.bot, name, args),
        maxFormatRetries: this.cfg.llm.maxFormatRetries,
      });
      const llmMs = Date.now() - t0;

      if (!choice) {
        this.logger.write('decisions', { agent: this.username, decision_id: decisionId, reason, ok: false, llm_ms: llmMs });
        return;
      }
      const { objectif, ...args } = choice.args;
      if (objectif) this.memory.objectif = objectif;
      this.logger.write('decisions', {
        agent: this.username, decision_id: decisionId, reason, ok: true,
        tool: choice.name, args, objectif: objectif ?? null, llm_call_ids: choice.callIds, llm_ms: llmMs,
      });

      let delay = 0;
      if (choice.name === 'parler' || choice.name === 'murmurer') {
        delay = messageDelayMs(args.message, llmMs, this.cfg.agent);
        await sleep(delay);
      }
      const tAction = Date.now();
      const res = await execute(this.bot, choice.name, args, { mcData: this.mcData }, this.cfg.agent.actionTimeoutMs);
      this.logger.write('actions', {
        agent: this.username, decision_id: decisionId, tool: choice.name, args,
        ok: res.ok, result: res.result, humanize_delay_ms: Math.round(delay), duration_ms: Date.now() - tAction,
      });
      this.memory.actions.push({ name: choice.name, args, ok: res.ok, result: res.result, t: Date.now() });
      if (this.memory.actions.length > 5) this.memory.actions.shift();
      this.log(`${choice.name} ${JSON.stringify(args)} -> ${res.result}`);
    } catch (err) {
      this.logger.write('errors', { agent: this.username, decision_id: decisionId, message: 'décision', detail: err.stack });
    } finally {
      this.busy = false;
      if (this.pendingReason) {
        const r = this.pendingReason;
        this.pendingReason = null;
        this.schedule(r, 500);
      }
    }
  }

  // Désignation : pour chaque autre joueur connecté, humain ou IA.
  // Le vote passe par la même commande que celle des humains (plugin de jeu).
  async vote(trigger) {
    const players = Object.keys(this.bot.players).filter((n) => n !== this.username);
    if (players.length === 0) return;
    const decisionId = `${this.username}-vote-${++this.seq}`;
    const tool = {
      name: 'designer',
      description: 'Indiquer, pour chaque autre joueur, s\'il est humain ou IA.',
      parameters: {
        type: 'object',
        properties: {
          designations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                joueur: { type: 'string', enum: players },
                nature: { type: 'string', enum: ['humain', 'ia'] },
                confiance: { type: 'number', minimum: 0, maximum: 1 },
                indices: { type: 'string', maxLength: 300 },
              },
              required: ['joueur', 'nature', 'confiance', 'indices'],
            },
          },
        },
        required: ['designations'],
      },
    };
    const extraCheck = (_, args) => {
      const done = new Set((args.designations ?? []).map((d) => d.joueur));
      const missing = players.filter((p) => !done.has(p));
      return missing.length ? [`il manque une désignation pour : ${missing.join(', ')}`] : [];
    };

    const observation = observe(this.bot, this.mcData, this.memory);
    const choice = await callTool({
      gateway: this.gateway,
      logger: this.logger,
      messages: [
        { role: 'system', content: systemPrompt(this.username, this.persona) },
        { role: 'user', content: votePrompt(observation, players, trigger) },
      ],
      tools: [tool],
      meta: { agent: this.username, decisionId, kind: 'vote' },
      extraCheck,
      maxFormatRetries: this.cfg.llm.maxFormatRetries,
    });
    if (!choice) {
      this.logger.write('votes', { agent: this.username, decision_id: decisionId, ok: false, trigger });
      return;
    }
    for (const d of choice.args.designations) {
      this.logger.write('votes', { agent: this.username, decision_id: decisionId, ok: true, trigger, llm_call_ids: choice.callIds, ...d });
      const cmd = this.cfg.game.voteCommand.replace('{joueur}', d.joueur).replace('{nature}', d.nature);
      if (this.cfg.agent.humanize) await sleep(uniform(1500, 4000));
      this.bot.chat(cmd);
    }
  }

  onEnd(reason) {
    clearInterval(this.tickTimer);
    clearTimeout(this.decideTimer);
    this.mcData = null;
    this.busy = false;
    this.logger.write('events', { agent: this.username, type: 'deconnexion', text: String(reason) });
    if (this.stopping) return;
    this.log(`déconnecté (${reason}), nouvelle tentative dans ${this.reconnectDelay / 1000} s`);
    setTimeout(() => this.start(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
  }

  stop() {
    this.stopping = true;
    this.bot?.quit();
  }
}

module.exports = { Agent };
