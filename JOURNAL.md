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
