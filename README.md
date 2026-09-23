# SAE S5 DATAIA - Sujet 5 : "Humain ou IA ?" sur un serveur Minecraft

## Présentation du projet
Ce projet s'inscrit dans le cadre de la SAE du semestre 5 du BUT Informatique de Reims (parcours DATAIA).

L'objectif est d'implementer un serveur Minecraft personnalisé permettant à 3 joueurs humains et 3 agents autonomes pilotés par des modèles de langage (LLM) de jouer ensemble. Les participants accomplissent des tâches (collecte, fabrication, construction, livraisons) et peuvent intéragir via un canal de discussion et du troc.

À des intervalles prédéfinis, chaque participant (humain ou agent) doit désigner qui, selon lui, est un humain et qui est une IA. Le projet vise à analyser le taux de detection, le comportement des agents et les critères de distinction utilisés par les humains (latence, style de message, logique d'actions).

---

## Architecture du système
Le système est découpé en plusieurs composants indépendants :
1. Serveur de jeu Minecraft (PaperMC) : Héberge la partie, gère les règles du jeu, le plugin de tâches/troc/désignation et enregistre les évènements/traces.
2. Agents LLM (Bots Mineflayer - Node.js) : Intéragissent avec le jeu exactement comme un joueur humain (via le client du jeu et la messagerie sans privilège sur le serveur).
3. Passerelle LiteLLM : Intermédiaire unique pour l'envoi des requêtes aux modèles LLM, la gestion des quotas, de la latence et des sorties structurées.
4. Système de suivi et observabilité (Langfuse / SQLite / PostgreSQL) : Enregistrement complet des logs de partie, des requêtes/réponses LLM (jetons, latence, coût) et des votes de désignation anonymisés.
5. Client maître du jeu : Interface d'intéraction en langage naturel pour piloter et superviser les sessions de jeu.

---

## Structure du depôt

```text

├── code/
│   ├── server/           # Configuration et plugins du serveur Minecraft (PaperMC)
│   ├── agents/           # Bots Mineflayer (Node.js) et connecteurs LLM
│   └── game_master/      # Client "Maître du jeu"
├── infra/                # Fichiers de déploiement (Docker Compose, scripts)
├── data/                 # Logs de parties, schémas de BDD
├── docs/                 # Notes techniques, présentations et documents du projet
├── JOURNAL.md            # Journal de bord (suivi quotidien des avancées et decisions)
└── README.md             # Présentation et guide du depôt
```

---

## Journal de Bord et Relevé de Temps
- Le suivi quotidien des decisions, tests et avancées est disponible dans JOURNAL.md.
- Le temps de travail de l'équipe est comptabilisé via l'outil de suivi adapté (Kimai / TimeTagger / autre).

---

## Equipe et Encadrement
- Etudiants (Groupe) : Matteo Godart, Ayoub Seghir, Yacine Mounsi
- Enseignants referents : Lydie Sandron, Ingrid Zmolnig, Frederic Blanchard
- Etablissement : IUT de Reims Champagne-Ardenne - BUT Informatique (Parcours DATAIA)