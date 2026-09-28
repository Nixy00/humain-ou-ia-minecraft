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