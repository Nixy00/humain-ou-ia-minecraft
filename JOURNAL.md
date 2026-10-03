# SAÉ S5 DATAIA - Sujet 5 : « Humain ou IA ? » sur un serveur Minecraft

## Journal de bord

### Semaine 39 (21/09/2026 - 27/09/2026)

#### Lundi 21 septembre 2026
* **Objectif de la journée :** Prise en main du sujet, cadrage du projet et compréhension des exigences.
* **Travail réalisé :**
    * Lecture complète du cahier des charges de la SAÉ S5 DATAIA et des consignes spécifiques au Sujet 5 (« Humain ou IA ? » sur Minecraft).
    * Analyse des attentes concernant l'observabilité, la passerelle LiteLLM, les règles du jeu et la pseudonymisation des données.
    * Discussion d'équipe sur l'organisation globale du projet et la répartition initiale des réflexions.

#### Mardi 22 septembre 2026
* **Objectif de la journée :** Réflexion sur l'architecture technique, choix d'infrastructures et premier déploiement VM.
* **Travail réalisé :**
    * Brainstorming sur les solutions techniques possibles pour connecter des agents autonomes à un serveur Minecraft sans privilèges d'accès.
    * Réflexion sur le choix de l'infrastructure (PaperMC, bots Mineflayer en Node.js, LiteLLM).
    * Tentative de mise en place de la machine virtuelle sur OpenNebula :
        * Rencontre de blocages lors de l'installation d'Ubuntu sur la VM.
        * Prise de décision de reporter la résolution du problème de VM à la séance du mercredi.

#### Mercredi 23 septembre 2026
* **Objectif de la journée :** Initialisation du dépôt et débogage de l'infrastructure.
* **Travail réalisé :**
    * Rédaction et publication du fichier `README.md` sur le dépôt GitLab (présentation du projet, architecture ciblée, structure des dossiers).
    * Initialisation du journal de bord (`JOURNAL.md`).
    * Reprise de la configuration de la VM Ubuntu sur OpenNebula. Installation de OpenJDK 21 Headless.
    * Création et configuration de l'utilisateur dédié `minecraft` sans privilèges `sudo` par des règles RBAC plus strict pour les utilisateurs.

#### Jeudi 24 septembre 2026
* **Objectif de la journée :** Déploiement du serveur PaperMC, sécurisation de l'environnement et mise en place du contrôle RCON.
* **Travail réalisé :**
    * Déploiement du serveur PaperMC 1.20.4.
    * Automatisation de la gestion du serveur via un service `systemd --user` (démarrage, arrêt, redémarrage en arrière-plan).
    * Configuration et activation du protocole RCON (Remote Console, protocole TCP permettant l'exécution de commandes d'administration à distance sans être connecté au jeu).

#### Vendredi 25 septembre 2026
* **Objectif de la journée :** Développement de l'assistant autonome et sécurisation des flux de mouvement.
* **Travail réalisé :**
    * Développement d'une première version (algorithmique) de l'assistant Minecraft utilisant des commandes en langage naturel.
    * Application des correctifs de mouvement et de l'anti-knockback pour stabiliser la connexion du bot sur le serveur PaperMC.

### Semaine 40 (28/09/2026 - 04/10/2026)

#### Lundi 28 septembre 2026
* **Objectif de la journée :** Brancher les bots sur un LLM.
* **Travail réalisé :**
    * Réécriture des bots : l'ancien bot à mots-clés est remplacé par 3 agents (Joueur4 à Joueur6) dont les décisions sont prises par un LLM via la passerelle LiteLLM.
    * Ajout d'un script de vérification du function calling et des réponses JSON (demandé en semaine 1).
    * Suppression de l'anti-knockback : c'était un avantage par rapport aux joueurs humains, ça fausse la comparaison.

#### Mercredi 30 septembre 2026
* **Objectif de la journée :** Faire le point sur le projet et mettre le code des agents sur GitLab.
* **Travail réalisé :**
    * Relecture du sujet et état des lieux de ce qui est fait et de ce qui reste.
    * Envoi du code des agents sur une branche `feat/agents-litellm`. On travaille maintenant par branches, `main` reste la version stable.
    * Correction d'une faille : un bot pouvait taper une commande serveur dans le chat (ex. voter plusieurs fois). Les messages qui commencent par `/` sont maintenant refusés.
    * Repéré : le mot de passe RCON est dans le dépôt et le port 25575 est ouvert, à corriger.

#### Vendredi 2 octobre 2026
* **Objectif de la journée :** Tester le LLM et ajouter des actions aux bots.
* **Travail réalisé :**
    * Récupération d'une clé pour la passerelle LiteLLM. Le modèle autorisé est `mistral-small-3.2-24b`.
    * Problème : la passerelle répondait « Invalid model name ». Même erreur avec le code du TP MR513, donc ça ne venait pas de notre code. Signalé à M. Blanchard.
    * Ajout de 13 actions aux bots (23 au total), reprises et simplifiées de Mindcraft : poser/casser un bloc, coffres, four, dormir, suivre un joueur, s'équiper, fuir... On a écarté ce qui triche (`/setblock`, téléportation, mode "cheat") et ce qui fausse le jeu (attaquer un joueur, l'IA qui écrit son propre code).
    * Ajout de réflexes automatiques sans LLM (se défendre, ne pas se noyer, se débloquer), car le LLM met plusieurs secondes à répondre.
    * Test de connexion d'un bot sur le serveur de la VM : ça marche.

#### Samedi 3 octobre 2026
* **Objectif de la journée :** Valider le LLM, tester les bots en jeu et chercher comment les rendre plus humains.
* **Travail réalisé :**
    * La passerelle fonctionne de nouveau. Vérification de la semaine 1 sur 20 essais par mode : **20/20 réponses valides en function calling et 20/20 en JSON**, environ 1,5 s de réponse.
    * Premier test en jeu : les bots se connectent, choisissent seuls leurs actions et parlent dans le chat (ex. « yo t'as pas un peu de bouffe ou un truc à échanger ? » à un joueur).
    * Bug corrigé : si le bot se déconnectait pendant qu'il attendait avant d'écrire, le message partait sur la nouvelle connexion pas encore prête. L'action est maintenant annulée.
    * Problème serveur : une quinzaine d'anciens bots `AssistantBot` tournent encore sur la VM (17 joueurs sur 20). Le serveur est saturé, tout le monde se fait déconnecter, y compris les joueurs humains. Il faut les arrêter sur la VM.
* **Recherches : rendre les bots plus humains**
    * **Délai des messages.** Dans le test de Turing de Jones et Bergen (UCSD), les messages de l'IA étaient envoyés avec un délai de : 1 s + 0,3 s par caractère écrit + 0,03 s par caractère du message lu + un temps de réflexion aléatoire. Notre délai actuel (6 caractères/s) est un peu trop rapide, on va reprendre cette formule.
    * **Ce qui trahit une IA dans le chat** (même étude) : trop formel, grammaire trop parfaite, ton "ChatGPT", trop bavard, personnage forcé (trop d'argot), fautes peu crédibles. Leur consigne qui marchait le mieux : messages courts, minuscules, peu de ponctuation, quelques fautes de frappe.
    * **Latence et détection.** Une autre étude montre que plus un LLM met de temps à répondre, plus on le repère (environ 25-30 % à 2 s, 60-75 % à 9 s, 80-85 % à 20 s), mais c'est sur des tâches de type assistant. Dans un jeu, un humain met aussi plusieurs secondes à écrire, il faut donc un délai réaliste, pas le plus court possible.
    * **Bots Minecraft "humains" existants.** MISHRI : délai de chat de 2,5 à 10 s, 15 % de fautes de frappe avec correction, visée avec bruit aléatoire, rotations de la tête en courbe. minecraft-ai-companion : le bot ne répond pas à environ 85 % des évènements banals, se laisse distraire, hésite.
    * **Combat.** Nos bots touchent à 100 %, tournent la tête instantanément et frappent à un rythme fixe. Un humain réagit en environ 250 ms (± 40 ms), clique 6-7 fois par seconde en moyenne (8-12 en PvP) et rate des coups. À ajouter : temps de réaction, rythme irrégulier, chance de rater, rotation progressive.
    * **Personnalités.** On part de la taxonomie de Bartle (1996, "Hearts, Clubs, Diamonds, Spades: Players Who Suit MUDs"), qui classe les joueurs selon deux axes : agir ou interagir, avec le monde ou avec les autres joueurs. Ça donne 4 types : Achiever (réussir, progresser), Explorer (découvrir), Socializer (discuter, aider), Killer (compétition). Limite : le modèle n'a jamais été validé par des données ; Nick Yee (2006) a montré par questionnaire que les motivations se combinent au lieu de s'exclure (3 grands facteurs : accomplissement, social, immersion). On utilise donc Bartle pour le type dominant de chaque bot, en lui donnant aussi un peu des autres.
    * **Choix retenu :** Joueur4 = Socializer, Joueur5 = Achiever, Joueur6 = Explorer (un Killer "chambreur" plus tard, sans attaquer les joueurs). Aucun ne doit être un assisté ni un joueur parfait.
    * **Sources :** Jones & Bergen, *People cannot distinguish GPT-4 from a human in a Turing test* (arXiv 2405.08007) ; *The Impact of Response Latency and Task Type on Human-LLM Interaction and Perception* (arXiv 2604.06183) ; github.com/emilyspringerton/MISHRI ; github.com/kustash01/minecraft-ai-companion ; Bartle (1996), Journal of MUD Research ; Yee (2006), *Motivations for Play in Online Games* ; humanbenchmark (temps de réaction) ; tests de CPS Minecraft.
* **Chat plus humain : ce qu'on a mis en place**
    * **Personnalités (Bartle)** : Joueur4 = Socializer, Joueur5 = Achiever, Joueur6 = Explorer. Chaque bot a ses propres réglages dans `agents.json` : vitesse de frappe, envie de répondre quand on ne lui parle pas, taux de fautes de frappe, taux de coups ratés, taux d'accents.
    * **Comportement** : délai des messages selon la formule de Jones et Bergen (12 s max), les bots ne répondent pas à tout (toujours si on les appelle par leur nom), fautes de frappe avec parfois la correction ("*peux"), petite pause avant chaque action, combat imparfait (temps de réaction, visée pas parfaite, coups dans le vide, rythme irrégulier), regards autour d'eux quand ils ne font rien. Tout se désactive avec `AGENT_HUMANIZE=false` pour comparer avec et sans.
    * **Recherche sur le vocabulaire** : il n'y a pas un seul jargon. Sur les forums (jeuxvideo.com), les joueurs ne sont pas d'accord entre "établi", "table de craft" et "table de travail", ni entre "cobble" et "pierre". On a donc donné un vocabulaire différent à chaque archétype : Joueur4 parle comme un jeune (wsh, tkt, frr, de temps en temps), dit "pierre" et "table de craft" ; Joueur5 utilise le vocabulaire d'un joueur expérimenté (cobble, stuff, full fer, stack, farm) ; Joueur6 parle un français simple (pierre, établi, grotte, minerai).
    * **Types de messages** : on ne veut pas que des échanges. Chaque personnalité a des exemples de réactions ("raah", "oh"), d'appels ("venez au spawn"), de questions ("comment on fait un seau ?"), de découvertes ("y a une grotte énorme ici"), de plaintes ("jsuis mort encore"), de départs ("brb", "afk 2 min") et de félicitations ("gg"). Des exemples marchent mieux qu'une description pour que le modèle copie un style.
    * **Démo de chat avec le vrai modèle (scénario simulé)** : premiers problèmes repérés qui trahissaient l'IA, puis corrigés : identifiants techniques dans le chat ("oak_log", maintenant refusé et reformulé), un bot qui recopie la réponse d'un autre, un bot qui propose des diamants qu'il n'a pas, majuscules et points en fin de phrase, coordonnées trop précises, formules polies ("si ça t'aide"), et la réponse "non, je suis un joueur normal" quand on demande s'il y a un bot (maintenant "mdr quoi t'es sérieux ?").
    * **Accents** : dans un chat on met rarement les accents. Chaque mot accentué garde ses accents seulement avec une petite probabilité (10 % pour Joueur5, 15 % pour Joueur4, 35 % pour Joueur6), sinon "sérieux" devient "serieux". C'est de l'aléatoire dans l'aléatoire : pas tous les mots, pas tous les messages.
    * **Reste à voir en jeu** : les bots réagissent encore peu aux évènements (mort, creeper) dans la démo ; à vérifier dans une vraie partie.
* **Mise en place sur la VM et premier vrai test en jeu**
    * **Accès SSH** : la console OpenNebula demande un mot de passe que personne n'a (les VM de l'IUT n'acceptent que les clés SSH). On a ajouté notre clé dans le contexte de la VM (onglet Conf, Update Configuration). Le formulaire refusait la modification ("restricted attribute DISK") : on est passé par le mode Advanced en n'envoyant que les parties modifiables (CONTEXT, OS, FEATURES, GRAPHICS, CPU_MODEL). La clé a été prise à chaud, sans redémarrer la VM.
    * **Serveur saturé** : 17 anciens bots `AssistantBot` tournaient depuis 5 jours et prenaient 4 Go sur 8. Après leur arrêt, la mémoire utilisée est passée de 6,3 Go à 2-3 Go et les "Timed out" des joueurs ont disparu.
    * **Serveur arrêté par erreur** : le serveur est un service systemd de l'utilisateur `minecraft`, mais sans "linger" il ne vit que si une session de cet utilisateur est ouverte. La dernière session ouverte contenait les anciens bots : en les arrêtant, le serveur s'est arrêté avec (proprement, monde sauvegardé). Corrigé avec `loginctl enable-linger minecraft` : le serveur tourne maintenant en permanence et redémarre tout seul.
    * Nos agents tournent dans un dossier séparé (`~/sae-s5-ia`) à la même version que GitLab ; le dossier du serveur n'a pas été touché.
* **Bugs trouvés pendant le test et corrigés**
    * Le bot se faisait expulser quand on le frappait ("Invalid move player packet") : minecraft-data 3.117 a renommé le champ de vitesse du paquet de recul (`velocity` au lieu de `velocityX/Y/Z`) mais mineflayer 4.25 lit encore les anciens noms, la position devenait NaN. On recopie les valeurs sous les anciens noms (le recul reste normal, ce n'est pas un anti-knockback). La vraie correction serait mineflayer >= 4.34, qui demande Node 22 (la VM a Node 20).
    * Le bot ne venait pas quand on l'appelait : après une action ratée, `pathfinder.stop()` laissait un ordre d'arrêt en attente qui annulait le déplacement suivant en 1 ms. Remplacé par `setGoal(null)`.
    * Il cherchait de la "cobblestone" dans la nature (elle n'existe pas) : il mine maintenant la pierre qui la donne.
    * Il répétait le même message en boucle, utilisait l'apostrophe typographique, et disait "je te vois pas" alors que le joueur était à 2 blocs (le modèle lisait mal "à 2 blocs") : corrigé.
* **Recherche : comment parlent de vrais joueurs**
    * Jeu de données "Minecraft Server Chat" (Hugging Face, 2 millions de messages d'un vrai serveur, licence CC0, en anglais). Sur 1000 messages : 2 mots en médiane, 63 % des messages font 1 à 3 mots, 3 % plus de 10 mots, argot (lol, bruh...) dans 5 % des messages seulement, jamais de point final. Nos bots écrivaient environ 8 mots avec de l'argot dans presque chaque message.
    * Correction : messages courts (plus de 12 mots = refusé), argot environ 1 message sur 20, exemples de messages raccourcis pour chaque personnalité.
    * Pour le français, le corpus 88milSMS (88 000 SMS authentiques anonymisés, licence CC BY 4.0, plateforme Ortolang/CoMeRe) pourra servir à calibrer les abréviations françaises.
    * On ne récupère pas les conversations de serveurs publics : les joueurs n'ont pas donné leur accord, ce qui irait contre la règle du sujet sur le consentement et la pseudonymisation. On s'appuie sur des corpus publics sous licence et sur nos propres parties.
    * **Sources des recherches de la semaine :**
        * Jones & Bergen, *People cannot distinguish GPT-4 from a human in a Turing test*, UC San Diego, arXiv 2405.08007 : https://arxiv.org/abs/2405.08007 (formule de délai des messages, consignes de personnage, raisons pour lesquelles une IA est repérée).
        * *The Impact of Response Latency and Task Type on Human-LLM Interaction and Perception*, arXiv 2604.06183 : https://arxiv.org/abs/2604.06183 (latence et détection).
        * Bartle, *Hearts, Clubs, Diamonds, Spades: Players Who Suit MUDs*, Journal of MUD Research, 1996 : https://en.wikipedia.org/wiki/Bartle_taxonomy_of_player_types
        * Yee, *Motivations for Play in Online Games*, 2006 : https://nickyee.com/pubs/Yee%20-%20Motivations%20(2007).pdf (critique de Bartle : motivations combinées).
        * MISHRI, bot Minecraft "humain" : https://github.com/emilyspringerton/MISHRI (idées seulement, licence pas claire).
        * minecraft-ai-companion (licence MIT) : https://github.com/kustash01/minecraft-ai-companion (probabilités de réponse, fautes de frappe, bruit de visée).
        * Mindcraft (licence MIT) : https://github.com/mindcraft-bots/mindcraft (actions et réflexes repris et simplifiés).
        * Minecraft Server Chat, Hugging Face, licence CC0 : https://huggingface.co/datasets/declip/Minecraft-Server-Chat (statistiques de longueur et d'argot).
        * Corpus 88milSMS, CoMeRe/Ortolang, licence CC BY 4.0 : https://repository.ortolang.fr/api/content/comere/v3.2/cmr-88milsms.html
        * Vocabulaire des joueurs francophones : forum jeuxvideo.com (débat établi / table de craft / table de travail), glossaire JeuxOnline : https://minecraft.jeuxonline.info/article/9660/glossaire-minecraft
        * Temps de réaction humain (~250 ms) : https://humanbenchmark.me/tests/reactiontime/average ; CPS en PvP Minecraft : https://click-battle.com/blog/best-cps-for-minecraft-pvp ; vitesse de frappe des joueurs : https://typingtest.now/faq/typing-speed-for-gamers/

#### Dimanche 4 octobre 2026 (nuit du 3 au 4)
* **Objectif de la séance :** Tester Joueur4 en jeu avec un humain et corriger ce qui bloque.
* **Méthode :** à chaque test, lecture des journaux de la partie (chronologie chat / décisions / actions) et résumé avec le script Python `analyse/analyse_partie.py`, puis correction dans un petit commit, déploiement sur la VM et nouveau test.
* **Causes trouvées et corrections :**
    * Le bot ne réagissait presque pas aux messages : une demande d'un joueur reçue pendant une action était écrasée par la minuterie (22 décisions sur 25 venaient de la minuterie). Corrigé, puis : s'ils ne sont que deux sur le serveur il répond toujours, et quand on lui parle il interrompt son action (récolte, attente, suivi).
    * Il perdait le fil : il voyait les messages des autres d'un côté et les siens de l'autre. Ajout d'un vrai fil de conversation (20 messages dans l'ordre, sans les réflexes ni les arrivées) et d'un carnet de notes que l'IA peut remplir (`notes.jsonl`). Le modèle n'utilise pas encore le carnet.
    * Aucune récolte ne marchait (0 sur 10). Trois causes : (1) `spawn-protection=16` empêche les joueurs non-admin de casser quoi que ce soit à moins de 16 blocs du point d'apparition, et les arbres proches étaient dedans (passé à 0) ; (2) mineflayer 4.25 était trop ancien pour la version de minecraft-data installée : le serveur refusait en silence certaines actions (poser, fabriquer) et le bot croyait avoir réussi. Passage à mineflayer 4.39, ce qui a demandé de mettre Node 22 sur la VM ; (3) le pathfinder pouvait tourner en rond sans fin vers une bûche en hauteur : déplacements limités dans le temps, plusieurs blocs essayés, objet tombé ramassé, résultat annoncé d'après l'inventaire réel.
    * Messages d'erreur trompeurs ("il faut un établi" alors qu'il manquait des planches) : on indique maintenant seulement ce qui manque vraiment.
    * Le bot plantait quand il mourait (réflexe noyade avec un bloc pas encore chargé) : corrigé, et une erreur dans un réflexe ne fait plus planter le programme.
    * Il refusait de donner ses coordonnées : à cause de notre propre consigne ("ne donne pas de coordonnées"). Il les donne maintenant quand on les demande.
* **Coût :** requêtes réduites de 5 300 à 3 900 tokens (-27 %) en expliquant une seule fois les champs communs aux outils ; minuterie à 30 s. Un seul bot consomme encore environ 75 000 tokens toutes les 5 minutes : on l'arrête quand personne ne joue.
* **Résultats entre le premier et le dernier test :** récoltes réussies 0/10 → 2/3 (bûches réellement dans l'inventaire), réaction aux messages du joueur 2 sur ~8 → 7 décisions sur 7 messages, délai de réponse de plus d'une minute → 2 à 7 s, messages de 2-3 mots en médiane. Il enchaîne seul planches puis table de craft grâce aux messages d'erreur.
* **Données disponibles sans rien coder (serveur vanilla) :** `logs/latest.log` (connexions, chat, commandes dont les /msg, morts et causes, succès, expulsions), `world/stats/<uuid>.json` (blocs minés, objets fabriqués/ramassés, monstres tués, morts, distances, temps de jeu), `world/advancements/<uuid>.json` (succès avec date), `world/playerdata/<uuid>.dat` (inventaire, position). Attention : ces fichiers contiennent les vrais pseudos, les IP (`log-ips=true`) et le texte des messages privés, il faudra pseudonymiser avant l'analyse et passer `log-ips=false`.
* **Reste à faire sur l'agent :** carnet de notes ignoré par le modèle, encore un peu de "mdr", construire une maison (un bloc à la fois est trop lent), aller vers un joueur trop loin pour être visible.
