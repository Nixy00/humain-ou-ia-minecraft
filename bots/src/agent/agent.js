// Un agent = un bot Mineflayer controle par le LLM.
// Boucle : on regarde la situation -> on demande au LLM -> on fait l'action.

const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const minecraftData = require('minecraft-data');

const { observe } = require('./perception');
const { execute, checkArgs, outilsUtiles, OUTIL_REFLEXION } = require('./actions');
const { systemPrompt, turnPrompt, reflexionPrompt, votePrompt } = require('./prompt');
const { STYLE_DEFAUT, messageDelayMs, fauteDeFrappe, ecrireCommeJoueur, enleverAccents, delaiAvantAction, uniform } = require('./humanizer');
const { startReflexes } = require('./reflexes');
const { prochaineEtape, objetDeMission, objectifDuMoment } = require('./plan');
const { NB_BLOCS } = require('./construction');
const { objetDemande, coutDemande, delaiReaction, dejaRepondu } = require('./demandes');
const { callTool } = require('../llm/structured');

const HUMEURS = ['motivé', 'normal', 'normal', 'un peu fatigué', 'de bonne humeur'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


class Agent {
  constructor({ username, persona, style, envie, objectifs, caractere }, { cfg, gateway, logger }) {
    this.username = username;
    this.persona = persona;
    this.objectifs = objectifs || [];
    this.caractere = caractere || { serviable: 0.5, flemme: 0.5 };
    // Humeur tirée au hasard pour la partie : le même bot n'est pas toujours aussi motivé.
    this.humeur = HUMEURS[Math.floor(Math.random() * HUMEURS.length)];
    this.style = { ...STYLE_DEFAUT, ...style };
    this.actionEnCours = null;
    this.cfg = cfg;
    this.gateway = gateway;
    this.logger = logger;
    this.memory = { events: [], chat: [], actions: [], notes: [], demandes: [], promesses: [], historique: [], avis: {}, reflexion: null, objectifPerso: null, envie: envie || '', mission: cfg.agent ? cfg.agent.mission : '' };
    this.seq = 0;
    this.pense = false; // le cerveau est en train de décider
    this.numeroAction = 0; // pour savoir si l'action qui finit a été remplacée par une autre
    this.pendingReason = null;
    this.frappePar = {}; // joueur -> dernière fois qu'il m'a frappé
    this.dejaVu = {}; // joueur -> dernière fois que je l'ai remarqué près de moi
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
    // Plugins utilisés par les actions de Mindcraft (récolte, combat, armure mise toute seule).
    bot.loadPlugin(require('mineflayer-collectblock').plugin);
    bot.loadPlugin(require('mineflayer-pvp').plugin);
    bot.loadPlugin(require('mineflayer-armor-manager'));

    bot.once('spawn', () => {
      this.reconnectDelay = 5000;
      this.mcData = minecraftData(bot.version);
      // Recettes de Mindcraft, pour calculer la prochaine étape de la mission (plan.js).
      import('../mindcraft/mcdata.mjs').then((mc) => {
        mc.init(bot.version);
        this.recettes = mc.getItemCraftingRecipes;
      });
      this.ouvrirVue(bot);
      const moves = new Movements(bot);
      moves.canDig = false; // on ne casse pas de blocs pour se déplacer (constructions des autres)
      bot.pathfinder.setMovements(moves);
      bot.pathfinder.thinkTimeout = 10000; // 5 s par défaut : trop court pour les blocs dans les grottes ("Took to long to decide path")
      // Sans limite, la recherche de chemin vers un diamant au fond d'une grotte a rempli 2 Go de mémoire et fait planter le bot.
      bot.pathfinder.searchRadius = 96;
      this.log('connecté');
      this.logger.write('events', { agent: this.username, type: 'connexion' });
      this.tickTimer = setInterval(() => {
        // Aucun humain connecté : on ne dépense pas de tokens pour rien (sauf parties de test entre IA).
        if (!this.cfg.agent.sansHumain && !this.humainConnecte()) return;
        this.schedule('minuterie (rien ne s\'est passé récemment)', 0);
      }, this.cfg.agent.tickMs);
      // Les réflexes sont journalisés et ajoutés aux évènements vus par le LLM (sans déclencher de décision).
      this.reflexTimer = startReflexes(bot, this.style, () => this.actionEnCours, (type, detail) => this.onEvent({ type: 'reflexe', text: `${type} : ${detail}` }, null));
      // État du bot toutes les 10 s (etat.jsonl) : pour suivre la partie en direct et pouvoir la rejouer.
      this.etatTimer = setInterval(() => this.noterEtat(), 10000);
      // La réflexion toutes les 3 minutes (seulement quand il joue vraiment).
      this.reflexionTimer = setInterval(() => {
        if (this.cfg.agent.sansHumain || this.humainConnecte()) this.reflechir();
      }, 180000);
      this.schedule('tu viens de te connecter', uniform(3000, 8000));
      // Il remarque un joueur qui arrive près de lui (une fois toutes les 3 min au plus par joueur).
      this.vuTimer = setInterval(() => this.remarquerJoueurs(), 2000);
    });

    // Qui l'a frappé : le joueur le plus proche qui vient de donner un coup (Mineflayer ne donne pas l'attaquant).
    this.gestes = {};
    bot.on('entitySwingArm', (e) => { if (e.type === 'player') this.gestes[e.username] = Date.now(); });
    bot.on('entityHurt', (e) => {
      if (e !== bot.entity) return;
      const frappeur = Object.values(bot.players).find((p) => p.username !== this.username && p.entity
        && p.entity.position.distanceTo(bot.entity.position) < 5 && Date.now() - (this.gestes[p.username] || 0) < 800);
      if (!frappeur) return;
      this.frappePar[frappeur.username] = Date.now();
      this.onEvent({ type: 'frappe', text: `${frappeur.username} t'a frappé (vie ${Math.round(bot.health)}/20)` }, `${frappeur.username} vient de te frapper`);
    });

    bot.on('chat', (from, text) => {
      if (from === this.username) return;
      // Un joueur ne réagit pas à tout : toujours si on lui parle (ou s'ils ne sont que deux sur le serveur),
      // sinon selon son caractère (style.bavard).
      const seulsTousLesDeux = Object.keys(bot.players).length <= 2;
      // Un message à tout le monde ("vous", "qq1", "allo y'a quelqu'un") le concerne aussi :
      // pendant un test, "bande de fou allez me chercher..." et "vous pouvez parler ???" n'ont eu aucune réponse.
      const nomme = text.toLowerCase().includes(this.username.toLowerCase());
      const pourTous = !seulsTousLesDeux && !nomme && /(vous|tout le monde|qq1|qqun|quelqu'un|quelquun|personne|les gars)/i.test(text);
      const pourMoi = seulsTousLesDeux || nomme || pourTous;
      // Un vrai joueur cité ne répond que 2 fois sur 3 dans les 2 minutes (analyse/rythme_chat.py) :
      // occupé, il répond parfois seulement quand il a fini son action (il verra le message à ce moment-là).
      const plusTard = this.cfg.agent.humanize && !seulsTousLesDeux && this.actionEnCours && Math.random() < 0.3;
      const reagir = !plusTard && (pourMoi || !this.cfg.agent.humanize || Math.random() < this.style.bavard);
      // Ce qu'on lui demande reste affiché à part (le modèle n'utilisait jamais son carnet tout seul).
      if (pourMoi) {
        // On ne garde que le dernier message de chaque joueur : "envoie 2 diams" restait affiché 10 min
        // après "non tkt merci", et il renvoyait des diamants en boucle.
        this.memory.demandes = this.memory.demandes.filter((d) => d.from !== from);
        this.memory.demandes.push({ from, text, t: Date.now(), info: pourTous ? this.infoDemande(from, text) : '' });
        if (this.memory.demandes.length > 3) this.memory.demandes.shift();
      }
      if (pourTous) {
        this.onEvent({ type: 'chat', from, text }, null);
        this.reagirPlusTard(from, text);
        return;
      }
      // Le cerveau décide (il peut répondre et continuer son action, champ "dire" + outil continuer).
      this.onEvent({ type: 'chat', from, text }, reagir ? `message de ${from} : "${text}"` : null);
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

  // Vue 3D du bot dans un navigateur (option AGENT_VUE_PORT) : on regarde l'IA jouer en direct.
  // Joueur4 sur le port AGENT_VUE_PORT, Joueur5 sur le suivant, etc.
  ouvrirVue(bot) {
    if (!this.cfg.agent.vuePort) return;
    let viewer;
    try {
      viewer = require('prismarine-viewer').mineflayer;
    } catch {
      this.log("prismarine-viewer n'est pas installé : pas de vue 3D");
      return;
    }
    const port = this.cfg.agent.vuePort + Math.max(0, this.cfg.game.agents.indexOf(this.username));
    viewer(bot, { port, firstPerson: false });
    this.log(`vue 3D sur le port ${port} (http://adresse-de-la-machine:${port})`);
  }

  noterEtat() {
    const bot = this.bot;
    if (!bot || !bot.entity) return;
    const p = bot.entity.position;
    const inventaire = {};
    for (const i of bot.inventory.items()) inventaire[i.name] = (inventaire[i.name] || 0) + i.count;
    const heure = bot.time ? bot.time.timeOfDay : null;
    this.logger.write('etat', {
      agent: this.username,
      vie: Math.round(bot.health),
      faim: bot.food,
      x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z),
      dimension: bot.game.dimension,
      nuit: heure !== null && heure >= 12300 && heure <= 23850,
      niveau_xp: bot.experience ? bot.experience.level : null,
      inventaire,
      action: this.actionEnCours,
      joueurs: Object.keys(bot.players).length,
    });
  }

  humainConnecte() {
    return Object.keys(this.bot.players).some((nom) => !this.cfg.game.agents.includes(nom));
  }

  // Un joueur arrive à côté : un humain le remarque (le salue, l'ignore, se méfie...). Le cerveau décide.
  remarquerJoueurs() {
    const bot = this.bot;
    if (!bot || !bot.entity || (!this.cfg.agent.sansHumain && !this.humainConnecte())) return;
    for (const p of Object.values(bot.players)) {
      if (p.username === this.username || !p.entity) continue;
      const d = bot.entity.position.distanceTo(p.entity.position);
      if (d < 12 && Date.now() - (this.dejaVu[p.username] || 0) > 180000) {
        this.dejaVu[p.username] = Date.now();
        this.onEvent({ type: 'joueur', text: `${p.username} arrive près de toi (${Math.round(d)} blocs)` }, `${p.username} arrive près de toi`);
      }
    }
  }

  // Pas de combat contre un joueur sans raison : seulement s'il m'a frappé (2 dernières minutes)
  // ou si un duel a été proposé dans le chat. Un bot qui tape les humains au hasard gâcherait l'expérience.
  verifierCombat(name, args) {
    if (name !== 'combattre') return [];
    const frappe = Date.now() - (this.frappePar[args.joueur] || 0) < 120000;
    const duel = this.memory.chat.some((m) => Date.now() - m.t < 120000 && /duel|1v1|combat|bagarre|pvp|fight/i.test(m.text)
      && (m.from === args.joueur || m.text.toLowerCase().includes(String(args.joueur).toLowerCase())));
    return frappe || duel ? [] : [`${args.joueur} ne t'a pas frappé et aucun duel n'est prévu : propose un duel dans le chat d'abord (dire)`];
  }

  // Un joueur ne renvoie pas trois fois le même message : on refuse un message
  // qui commence comme un des 3 derniers, et le modèle doit dire autre chose.
  verifierRepetition(name, args) {
    const texte = args.dire ?? args.message;
    if (typeof texte !== 'string' || !texte.trim()) return [];
    // normalize('NFD') sépare les accents des lettres, puis on ne garde que a-z ("où" devient "ou").
    const mots = (t) => t.normalize('NFD').toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(Boolean);
    const nouveaux = mots(texte);
    // Mes 3 derniers messages : si presque tous les mots se retrouvent dans l'un d'eux, c'est une répétition
    // ("tas besoin fer ?" puis "tas toujours besoin fer ?" passaient avec l'ancienne comparaison des 8 premières lettres).
    const miens = this.memory.chat.filter((m) => m.from === this.username && !m.text.startsWith('*')).slice(-3);
    const debut = (t) => mots(t).join('').slice(0, 8);
    const repete = miens.some((m) => {
      const anciens = mots(m.text);
      return debut(m.text) === debut(texte) || nouveaux.filter((w) => anciens.includes(w)).length >= Math.ceil(nouveaux.length * 0.6);
    });
    if (repete) return ['tu as déjà écrit presque la même chose, dis autre chose ou attends'];
    // Reposer une question alors que personne n'a répondu depuis (il relançait les autres bots, occupés, en boucle).
    const dernier = this.memory.chat[this.memory.chat.length - 1];
    if (texte.includes('?') && dernier && dernier.from === this.username && dernier.text.includes('?') && Date.now() - dernier.t < 3 * 60000) {
      return ["personne n'a répondu à ta question, laisse tomber ou fais autre chose"];
    }
    // Nos bots posaient 2 fois plus de questions que de vrais joueurs (17 % contre 8 %, analyse/rythme_chat.py) :
    // pas plus d'une question toutes les 2 minutes.
    const questionRecente = this.memory.chat.some((m) => m.from === this.username && m.text.includes('?') && Date.now() - m.t < 2 * 60000);
    if (texte.includes('?') && questionRecente) return ['tu viens déjà de poser une question : dis-le sans question ou ne dis rien'];
    return [];
  }

  // Regroupe les évènements rapprochés : une seule décision après `delayMs` de calme.
  schedule(reason, delayMs) {
    if (!this.mcData) return;
    // Une demande d'un joueur ne doit jamais être remplacée par la minuterie
    // (sinon le bot oublie que quelqu'un lui a parlé).
    const enAttente = this.pense ? this.pendingReason : this.raisonPrevue;
    if (reason.startsWith('minuterie') && enAttente && !enAttente.startsWith('minuterie')) return;
    // Pendant une action, la minuterie ne le dérange pas : il sera réveillé quand l'action finira.
    if (reason.startsWith('minuterie') && this.actionEnCours) return;
    if (this.pense) {
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

  // Champs communs à tous les outils, gardés en mémoire et journalisés (notes.jsonl).
  retenirChamps(decisionId, note, promesse) {
    // Promesse ("jfinis ma cabane et jtaide") : il la voit pendant 20 min pour y revenir plus tard.
    if (promesse) {
      this.memory.promesses.push({ text: promesse, t: Date.now() });
      if (this.memory.promesses.length > 3) this.memory.promesses.shift();
      this.logger.write('notes', { agent: this.username, decision_id: decisionId, promesse });
    }
    // Carnet de notes : ce que l'IA veut retenir (10 dernières notes).
    if (note) {
      this.memory.notes.push({ text: note, t: Date.now() });
      if (this.memory.notes.length > 10) this.memory.notes.shift();
      this.logger.write('notes', { agent: this.username, decision_id: decisionId, note });
    }
  }

  // Envoie un message comme un joueur : faute de frappe possible, temps de lire et de taper, correction "*mot".
  async dire(texte, decisionId, llmMs) {
    const bot = this.bot;
    let delay = 0;
    let correction = null;
    if (this.cfg.agent.humanize) {
      const f = fauteDeFrappe(enleverAccents(ecrireCommeJoueur(texte), this.style.accents), this.style.fautes);
      texte = f.texte;
      correction = f.correction;
      const dernierMessage = [...this.memory.chat].reverse().find((m) => m.from !== this.username);
      delay = messageDelayMs(texte, dernierMessage ? dernierMessage.text : '', llmMs, this.style);
      // Occupé (en train de miner, de se battre...), on répond moins vite (Avrahami et Hudson, 2006).
      if (this.actionEnCours) delay += uniform(1000, 4000);
      await sleep(delay);
    }
    if (this.bot !== bot || !bot.entity) return;
    bot.chat(texte);
    this.retenirMessage({ type: 'chat', from: this.username, text: texte });
    this.logger.write('actions', {
      agent: this.username, decision_id: decisionId, tool: 'parler', args: { message: texte }, ok: true, result: 'message envoyé', humanize_delay_ms: Math.round(delay), duration_ms: 0,
    });
    this.log(`dit : ${texte}`);
    if (correction) {
      await sleep(uniform(1500, 3000));
      bot.chat(correction);
      this.retenirMessage({ type: 'chat', from: this.username, text: correction });
      this.logger.write('actions', { agent: this.username, decision_id: decisionId, tool: 'correction', args: { message: correction }, ok: true });
    }
  }

  // LA RÉFLEXION : toutes les 3 minutes il fait le point (résumé, avis sur les joueurs, intention, objectif).
  // Sans ça, il ne se souvenait que de ses 5 dernières actions et oubliait un défi 2 minutes après.
  async reflechir() {
    if (this.reflechit || this.stopping || !this.mcData || !this.bot?.entity) return;
    this.reflechit = true;
    const bot = this.bot;
    const decisionId = `${this.username}-reflexion-${++this.seq}`;
    const t0 = Date.now();
    try {
      const historique = this.memory.historique
        .map((a) => `- ${a.name} ${JSON.stringify(a.args)} -> ${a.ok ? 'réussi' : 'raté'} : ${a.result}`).join('\n');
      const choice = await callTool({
        gateway: this.gateway,
        logger: this.logger,
        messages: [
          { role: 'system', content: systemPrompt(this.username, this.persona, this.caractere, this.humeur) },
          { role: 'user', content: reflexionPrompt(observe(bot, this.mcData, this.memory), historique) },
        ],
        tools: [OUTIL_REFLEXION],
        meta: { agent: this.username, decisionId, kind: 'reflexion' },
        extraCheck: (name, args) => (args.nouvel_objectif && !bot.registry.itemsByName[args.nouvel_objectif]
          ? [`nouvel_objectif "${args.nouvel_objectif}" n'est pas un identifiant Minecraft`] : []),
        maxFormatRetries: this.cfg.llm.maxFormatRetries,
      });
      if (!choice) return;
      const r = choice.args;
      this.memory.reflexion = { resume: r.resume, intention: r.intention, t: Date.now() };
      for (const { joueur, avis } of r.avis || []) {
        if (joueur && avis && joueur !== this.username) this.memory.avis[joueur] = avis;
      }
      if (r.nouvel_objectif) this.memory.objectifPerso = { objet: r.nouvel_objectif, nombre: r.nombre || 1 };
      this.logger.write('decisions', {
        agent: this.username, decision_id: decisionId, kind: 'reflexion', ok: true, tool: 'reflexion', args: r,
        llm_call_ids: choice.callIds, llm_ms: Date.now() - t0,
      });
      this.log(`réflexion : ${r.intention}${r.nouvel_objectif ? ` (nouvel objectif : ${r.nouvel_objectif})` : ''}`);
    } catch (err) {
      this.logger.write('errors', { agent: this.username, decision_id: decisionId, message: 'réflexion', detail: err.stack });
    } finally {
      this.reflechit = false;
    }
  }

  // LE CERVEAU : une seule décision à la fois, qui contient l'action ET ce qu'il dit (champ "dire").
  // Avant, une "bouche" et des "mains" séparées pouvaient dire "jarrive" pendant que les mains faisaient autre chose
  // (même problème décrit dans Project Sid, réglé par un seul "contrôleur" qui décide pour la parole et les actions).
  // L'action tourne en fond : le cerveau peut décider pendant (quand on lui parle) et choisir "continuer".
  async decide(reason) {
    if (this.pense || this.stopping || !this.bot?.entity) return;
    this.pense = true;
    const bot = this.bot;
    const decisionId = `${this.username}-${++this.seq}`;
    const t0 = Date.now();
    let relancer = null;
    try {
      this.memory.etape = this.recettes ? this.etapeDuMoment(bot) : null;
      const observation = observe(bot, this.mcData, this.memory);
      const enCours = this.actionEnCours ? `${this.actionEnCours} (depuis ${Math.round((Date.now() - this.debutAction) / 1000)} s)` : null;
      const choice = await callTool({
        gateway: this.gateway,
        logger: this.logger,
        messages: [
          { role: 'system', content: systemPrompt(this.username, this.persona, this.caractere, this.humeur) },
          { role: 'user', content: turnPrompt(observation, reason, enCours) },
        ],
        // "continuer" seulement pendant une action : sans action, il le prenait pour "continuer mon plan" et ne faisait rien.
        tools: outilsUtiles(bot).filter((t) => t.name !== 'continuer' || this.actionEnCours),
        meta: { agent: this.username, decisionId, kind: 'decision' },
        extraCheck: (name, args) => [...checkArgs(bot, name, args), ...this.verifierRepetition(name, args), ...this.verifierEchecs(name, args), ...this.verifierCombat(name, args)],
        maxFormatRetries: this.cfg.llm.maxFormatRetries,
      });
      const llmMs = Date.now() - t0;
      if (!choice) {
        this.logger.write('decisions', { agent: this.username, decision_id: decisionId, reason, ok: false, llm_ms: llmMs });
        return;
      }
      // pensee : pourquoi il fait ça, en quelques mots. Jamais montrée en jeu, seulement dans les journaux (analyse).
      const { dire, note, promesse, pensee, ...args } = choice.args;
      this.retenirChamps(decisionId, note, promesse);
      this.logger.write('decisions', {
        agent: this.username, decision_id: decisionId, reason, ok: true,
        tool: choice.name, args, dire: dire ?? null, pensee: pensee ?? null, en_cours: this.actionEnCours, llm_call_ids: choice.callIds, llm_ms: llmMs,
      });
      this.log(`${choice.name} ${JSON.stringify(args)}${dire ? ` + dit "${dire}"` : ''}${pensee ? ` [pense : ${pensee}]` : ''}`);
      // Personne d'autre connecté : pas la peine de parler dans le vide.
      const parle = dire && Object.keys(bot.players).length > 1 ? this.dire(dire, decisionId, llmMs) : Promise.resolve();
      if (choice.name === 'continuer') {
        await parle;
        // Il ne fait rien : il redécidera un peu plus tard (comme un joueur qui regarde le chat).
        if (!this.actionEnCours) relancer = { raison: 'tu ne faisais rien depuis quelques secondes', delai: uniform(4000, 8000) };
        return;
      }
      // Une nouvelle action remplace celle en cours : on arrête proprement l'ancienne.
      if (this.actionEnCours) {
        this.numeroAction++; // l'ancienne action ne réveillera pas le cerveau en finissant
        bot.interrompre = true;
        bot.pathfinder.setGoal(null);
        await this.actionFin;
      }
      await parle; // il finit de taper avant d'agir (on ne bouge pas avec le chat ouvert)
      this.lancerAction(choice.name, args, decisionId, pensee);
    } catch (err) {
      this.logger.write('errors', { agent: this.username, decision_id: decisionId, message: 'décision', detail: err.stack });
    } finally {
      this.pense = false;
      if (this.pendingReason) {
        const r = this.pendingReason;
        this.pendingReason = null;
        this.schedule(r, 300);
      } else if (relancer) {
        this.schedule(relancer.raison, relancer.delai);
      }
    }
  }

  // Lance l'action en fond. Quand elle finit, le cerveau est réveillé (sauf si une autre action l'a remplacée).
  lancerAction(name, args, decisionId, pensee) {
    const bot = this.bot;
    const numero = ++this.numeroAction;
    this.actionEnCours = name;
    this.debutAction = Date.now();
    this.actionFin = (async () => {
      const delay = this.cfg.agent.humanize ? delaiAvantAction() : 0;
      await sleep(delay);
      if (this.bot !== bot || !bot.entity) return;
      const tAction = Date.now();
      const res = await execute(bot, name, args, { mcData: this.mcData, style: this.style }, this.cfg.agent.actionTimeoutMs);
      this.logger.write('actions', {
        agent: this.username, decision_id: decisionId, tool: name, args,
        ok: res.ok, result: res.result, humanize_delay_ms: Math.round(delay), duration_ms: Date.now() - tAction,
      });
      this.memory.actions.push({ name, args, ok: res.ok, result: res.result, t: Date.now() });
      if (this.memory.actions.length > 5) this.memory.actions.shift();
      this.memory.historique.push({ name, args, ok: res.ok, result: String(res.result).slice(0, 100), t: Date.now() });
      if (this.memory.historique.length > 30) this.memory.historique.shift();
      this.log(`${name} -> ${res.result}${pensee ? ` [pense : ${pensee}]` : ''}`);
      return res;
    })().catch((err) => {
      this.logger.write('errors', { agent: this.username, decision_id: decisionId, message: 'action', detail: err.stack });
      return { ok: false, result: err.message };
    }).then((res) => {
      if (numero !== this.numeroAction) return; // remplacée par une autre action : rien à faire
      this.actionEnCours = null;
      this.actionFin = null;
      if (res) this.suite(`ton action ${name} vient de finir (${res.ok ? 'réussie' : 'ratée'})`);
    });
  }

  // Mission de test (AGENT_MISSION) si elle existe, sinon le premier objectif du profil pas encore atteint.
  etapeDuMoment(bot) {
    const inv = bot.inventory.items();
    const mission = objetDeMission(this.memory.mission, this.mcData);
    // Mission finie : on le lui dit (sinon il refabriquait un deuxième casque avec ses diamants).
    if (mission) return prochaineEtape(mission, inv, this.recettes) || `aucune, mission accomplie (tu as ${mission}) : ne le refabrique pas, fais ce que tu veux`;
    // Objectif que le bot s'est fixé à sa réflexion (un défi accepté par exemple) : il passe avant son profil.
    if (this.memory.objectifPerso) {
      const o = this.memory.objectifPerso;
      const etape = prochaineEtape(o.objet, inv, this.recettes, o.nombre);
      if (etape) return etape;
      this.logger.write('events', { agent: this.username, type: 'objectif_atteint', text: `${o.nombre} ${o.objet}` });
      this.memory.objectifPerso = null;
    }
    const but = objectifDuMoment(this.objectifs.filter((o) => !(o === 'cabane' && bot.cabaneFinie)), inv);
    if (!but) return null;
    if (but.objet === 'cabane') {
      // Assez de blocs pour ce qu'il reste à poser ? Sinon l'étape est d'aller en chercher.
      const reste = bot.chantier ? bot.chantier.restants.length : NB_BLOCS;
      const pierre = inv.filter((i) => i.name === 'cobblestone').reduce((s, i) => s + i.count, 0);
      const planches = reste - pierre;
      return (planches > 0 && prochaineEtape('oak_planks', inv, this.recettes, planches)) || 'construire (ta cabane)';
    }
    return prochaineEtape(but.objet, inv, this.recettes, but.nombre);
  }

  // Ce que la demande me coûterait (demandes.js) : sert au délai, et affiché au modèle pour qu'il décide.
  coutPourMoi(from, text) {
    const bot = this.bot;
    const joueur = bot.players[from] && bot.players[from].entity;
    const possede = objetDemande(text, bot.inventory.items(), bot.registry);
    const distance = joueur ? Math.round(bot.entity.position.distanceTo(joueur.position)) : null;
    return { possede, distance, cout: coutDemande({ possede, distance, occupe: Boolean(this.actionEnCours), serviable: this.caractere.serviable }) };
  }

  infoDemande(from, text) {
    const { possede, distance } = this.coutPourMoi(from, text);
    const objet = possede === null ? '' : (possede > 0 ? `, tu en as ${possede}` : ", tu n'en as pas");
    return ` (à tout le monde${objet}, ${distance === null ? 'tu ne le vois pas' : `il est à ${distance} blocs`})`;
  }

  // Demande à tout le monde : plus ça me coûte, plus j'attends avant de réagir. Si un autre joueur a répondu
  // entre-temps, je le laisse faire sans appeler le modèle (comme un humain qui lit "jen ai" dans le chat).
  reagirPlusTard(from, text) {
    const bot = this.bot;
    const depuis = Date.now();
    setTimeout(() => {
      if (this.bot !== bot || !bot.entity) return;
      if (dejaRepondu(this.memory.chat, from, depuis, this.username)) {
        this.memory.demandes = this.memory.demandes.filter((d) => !(d.from === from && d.text === text));
        this.logger.write('events', { agent: this.username, type: 'laisse_faire', text: `<${from}> ${text}` });
        return;
      }
      this.schedule(`message de ${from} à tout le monde : "${text}"`, 0);
    }, delaiReaction(this.coutPourMoi(from, text).cout));
  }

  // La même action avec les mêmes arguments a raté 2 fois de suite : on refuse la 3e
  // (il a tenté de cuire sans combustible 5 fois de suite).
  verifierEchecs(name, args) {
    const cle = (n, a) => n + JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k]) => !['note', 'promesse', 'pensee'].includes(k))));
    const deux = this.memory.actions.slice(-2);
    const rate = deux.length === 2 && deux.every((a) => !a.ok && cle(a.name, a.args) === cle(name, args));
    return rate ? [`${name} a raté 2 fois de suite (${deux[1].result.slice(0, 80)}) : fais autre chose`] : [];
  }

  // Après une décision : une demande d'un joueur en attente passe d'abord.
  // Sinon, comme Mindcraft, on enchaîne dès que l'action finit, après une petite pause de joueur
  // (avant, il attendait la minuterie de 30 s et restait planté après une action de 2 s).
  suite(enchainer) {
    if (this.pendingReason) {
      const r = this.pendingReason;
      this.pendingReason = null;
      this.schedule(r, 500);
    } else if (enchainer && (this.cfg.agent.sansHumain || this.humainConnecte())) {
      this.schedule(enchainer, uniform(1000, 3000));
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
        { role: 'system', content: systemPrompt(this.username, this.persona, this.caractere, this.humeur) },
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
    if (this.bot && this.bot.viewer) this.bot.viewer.close(); // libère le port de la vue 3D avant de se reconnecter
    clearInterval(this.tickTimer);
    clearInterval(this.reflexTimer);
    clearInterval(this.etatTimer);
    clearInterval(this.reflexionTimer);
    clearInterval(this.vuTimer);
    clearTimeout(this.decideTimer);
    this.raisonPrevue = null;
    this.mcData = null;
    this.pense = false;
    this.numeroAction++;
    this.actionEnCours = null;
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
