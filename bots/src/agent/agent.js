// Un agent = un bot Mineflayer controle par le LLM.
// Boucle : on regarde la situation -> on demande au LLM -> on fait l'action.

const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const minecraftData = require('minecraft-data');

const { observe } = require('./perception');
const { TOOLS, execute, checkArgs } = require('./actions');
const { systemPrompt, turnPrompt, votePrompt } = require('./prompt');
const { STYLE_DEFAUT, messageDelayMs, fauteDeFrappe, ecrireCommeJoueur, enleverAccents, delaiAvantAction, uniform } = require('./humanizer');
const { startReflexes } = require('./reflexes');
const { callTool } = require('../llm/structured');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


class Agent {
  constructor({ username, persona, style }, { cfg, gateway, logger }) {
    this.username = username;
    this.persona = persona;
    this.style = { ...STYLE_DEFAUT, ...style };
    this.actionEnCours = null;
    this.cfg = cfg;
    this.gateway = gateway;
    this.logger = logger;
    this.memory = { events: [], chat: [], actions: [], notes: [], demandes: [], objectif: null };
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
      bot.pathfinder.thinkTimeout = 10000; // 5 s par défaut : trop court pour les blocs dans les grottes ("Took to long to decide path")
      this.log('connecté');
      this.logger.write('events', { agent: this.username, type: 'connexion' });
      this.tickTimer = setInterval(() => this.schedule('minuterie (rien ne s\'est passé récemment)', 0), this.cfg.agent.tickMs);
      // Les réflexes sont journalisés et ajoutés aux évènements vus par le LLM (sans déclencher de décision).
      this.reflexTimer = startReflexes(bot, this.style, () => this.actionEnCours, (type, detail) => this.onEvent({ type: 'reflexe', text: `${type} : ${detail}` }, null));
      this.schedule('tu viens de te connecter', uniform(3000, 8000));
    });

    bot.on('chat', (from, text) => {
      if (from === this.username) return;
      // Un joueur ne réagit pas à tout : toujours si on lui parle (ou s'ils ne sont que deux sur le serveur),
      // sinon selon son caractère (style.bavard).
      const seulsTousLesDeux = Object.keys(bot.players).length <= 2;
      const pourMoi = seulsTousLesDeux || text.toLowerCase().includes(this.username.toLowerCase());
      const reagir = pourMoi || !this.cfg.agent.humanize || Math.random() < this.style.bavard;
      // Quelqu'un lui parle : comme un joueur, il s'arrête dans ce qu'il fait pour répondre.
      if (pourMoi && this.actionEnCours) {
        bot.interrompre = true;
        bot.pathfinder.setGoal(null);
      }
      // Ce qu'on lui demande reste affiché à part (le modèle n'utilisait jamais son carnet tout seul).
      if (pourMoi) {
        this.memory.demandes.push({ from, text, t: Date.now() });
        if (this.memory.demandes.length > 3) this.memory.demandes.shift();
      }
      this.onEvent({ type: 'chat', from, text }, reagir ? `message de ${from}` : null);
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
      // Les arrivées/départs de joueurs sont notés mais ne déclenchent pas de décision (trop fréquents).
      const arriveeDepart = / (joined|left) the game$/.test(text);
      this.onEvent({ type: 'serveur', text }, arriveeDepart ? null : 'message du serveur');
    });
    bot.on('death', () => this.onEvent({ type: 'mort', text: 'tu es mort et tu as réapparu' }, 'tu viens de mourir'));
    bot.on('kicked', (reason) => this.logger.write('errors', { agent: this.username, message: 'expulsé', detail: typeof reason === 'string' ? reason : JSON.stringify(reason) }));
    bot.on('error', (err) => this.logger.write('errors', { agent: this.username, message: 'erreur client', detail: err.message }));
    bot.on('end', (reason) => this.onEnd(reason));
  }

  // Le chat (messages reçus et envoyés) est gardé à part des autres évènements :
  // les réflexes et les arrivées de joueurs ne doivent pas faire disparaître la conversation.
  retenirMessage(message) {
    this.memory.chat.push({ ...message, t: Date.now() });
    if (this.memory.chat.length > 20) this.memory.chat.shift();
  }

  onEvent(event, reason) {
    if (event.type === 'chat' || event.type === 'whisper') {
      this.retenirMessage(event);
    } else {
      this.memory.events.push({ ...event, t: Date.now() });
      if (this.memory.events.length > this.cfg.agent.maxEvents) this.memory.events.shift();
    }
    this.logger.write('events', { agent: this.username, ...event });
    if (reason) this.schedule(reason, this.cfg.agent.chatDebounceMs);
  }

  // Un joueur ne renvoie pas trois fois le même message : on refuse un message
  // qui commence comme un des 3 derniers, et le modèle doit dire autre chose.
  verifierRepetition(name, args) {
    if (name !== 'parler' && name !== 'murmurer') return [];
    // normalize('NFD') sépare les accents des lettres, puis on ne garde que a-z ("où" devient "ou").
    const debut = (t) => t.normalize('NFD').toLowerCase().replace(/[^a-z]/g, '').slice(0, 8);
    const derniers = this.memory.actions.filter((a) => a.name === name).slice(-3).map((a) => debut(a.args.message));
    return derniers.includes(debut(args.message)) ? ['tu as déjà écrit presque la même chose, dis autre chose ou attends'] : [];
  }

  // Regroupe les évènements rapprochés : une seule décision après `delayMs` de calme.
  schedule(reason, delayMs) {
    if (!this.mcData) return;
    // Une demande d'un joueur ne doit jamais être remplacée par la minuterie
    // (sinon le bot oublie que quelqu'un lui a parlé).
    const enAttente = this.busy ? this.pendingReason : this.raisonPrevue;
    if (reason.startsWith('minuterie') && enAttente && !enAttente.startsWith('minuterie')) return;
    if (this.busy) {
      this.pendingReason = reason;
      return;
    }
    clearTimeout(this.decideTimer);
    this.raisonPrevue = reason;
    this.decideTimer = setTimeout(() => {
      this.raisonPrevue = null;
      this.decide(reason);
    }, delayMs);
  }

  async decide(reason) {
    if (this.busy || this.stopping || !this.bot?.entity) return;
    this.busy = true;
    const bot = this.bot;
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
        extraCheck: (name, args) => [...checkArgs(this.bot, name, args), ...this.verifierRepetition(name, args)],
        maxFormatRetries: this.cfg.llm.maxFormatRetries,
      });
      const llmMs = Date.now() - t0;

      if (!choice) {
        this.logger.write('decisions', { agent: this.username, decision_id: decisionId, reason, ok: false, llm_ms: llmMs });
        return;
      }
      const { objectif, note, ...args } = choice.args;
      if (objectif) this.memory.objectif = objectif;
      // Carnet de notes : l'IA garde ce qu'elle veut retenir (10 dernières notes),
      // et tout est enregistré dans notes.jsonl pour l'analyse.
      if (note) {
        this.memory.notes.push({ text: note, t: Date.now() });
        if (this.memory.notes.length > 10) this.memory.notes.shift();
        this.logger.write('notes', { agent: this.username, decision_id: decisionId, note });
      }
      this.logger.write('decisions', {
        agent: this.username, decision_id: decisionId, reason, ok: true,
        tool: choice.name, args, objectif: objectif ?? null, llm_call_ids: choice.callIds, llm_ms: llmMs,
      });

      let delay = 0;
      let correction = null;
      if (this.cfg.agent.humanize) {
        if (choice.name === 'parler' || choice.name === 'murmurer') {
          // Faute de frappe possible, puis le temps de lire, réfléchir et taper.
          const f = fauteDeFrappe(enleverAccents(ecrireCommeJoueur(args.message), this.style.accents), this.style.fautes);
          args.message = f.texte;
          correction = f.correction;
          const dernierMessage = [...this.memory.events].reverse().find((e) => e.type === 'chat' || e.type === 'whisper');
          delay = messageDelayMs(args.message, dernierMessage ? dernierMessage.text : '', llmMs, this.style);
        } else {
          delay = delaiAvantAction();
        }
        await sleep(delay);
      }
      // Si le bot s'est déconnecté pendant l'attente, on abandonne l'action.
      if (this.bot !== bot || !bot.entity) {
        this.logger.write('errors', { agent: this.username, decision_id: decisionId, message: 'action annulée : bot déconnecté pendant la décision' });
        return;
      }
      const tAction = Date.now();
      this.actionEnCours = choice.name;
      const res = await execute(this.bot, choice.name, args, { mcData: this.mcData, style: this.style }, this.cfg.agent.actionTimeoutMs);
      this.actionEnCours = null;
      this.logger.write('actions', {
        agent: this.username, decision_id: decisionId, tool: choice.name, args,
        ok: res.ok, result: res.result, humanize_delay_ms: Math.round(delay), duration_ms: Date.now() - tAction,
      });
      const type = choice.name === 'murmurer' ? 'whisper' : 'chat';
      if ((choice.name === 'parler' || choice.name === 'murmurer') && res.ok) {
        this.retenirMessage({ type, from: this.username, to: args.joueur, text: args.message });
      }
      // Après une faute de frappe, le joueur envoie parfois la correction ("*mot").
      if (correction && res.ok) {
        await sleep(uniform(1500, 3000));
        bot.chat(choice.name === 'murmurer' ? `/msg ${args.joueur} ${correction}` : correction);
        this.retenirMessage({ type, from: this.username, to: args.joueur, text: correction });
        this.logger.write('actions', { agent: this.username, decision_id: decisionId, tool: 'correction', args: { message: correction }, ok: true });
      }
      this.memory.actions.push({ name: choice.name, args, ok: res.ok, result: res.result, t: Date.now() });
      if (this.memory.actions.length > 5) this.memory.actions.shift();
      this.log(`${choice.name} ${JSON.stringify(args)} -> ${res.result}`);
    } catch (err) {
      this.logger.write('errors', { agent: this.username, decision_id: decisionId, message: 'décision', detail: err.stack });
    } finally {
      this.busy = false;
      this.actionEnCours = null;
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
    clearInterval(this.reflexTimer);
    clearTimeout(this.decideTimer);
    this.raisonPrevue = null;
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
