# SAE S5 DATAIA - Sujet 5 : "Humain ou IA ?" sur un serveur Minecraft

## Présentation du projet
Ce projet s'inscrit dans le cadre de la SAE du semestre 5 du BUT Informatique de Reims (parcours DATAIA).

L'objectif est d'implementer un serveur Minecraft personnalisé permettant à 3 joueurs humains et 3 agents autonomes pilotés par des modèles de langage (LLM) de jouer ensemble. Les participants accomplissent des tâches (collecte, fabrication, construction, livraisons) et peuvent intéragir via un canal de discussion et du troc.

À des intervalles prédéfinis, chaque participant (humain ou agent) doit désigner qui, selon lui, est un humain et qui est une IA. Le projet vise à analyser le taux de detection, le comportement des agents et les critères de distinction utilisés par les humains (latence, style de message, logique d'actions).

---

## Architecture du système
Le système est découpé en plusieurs composants indépendants :
1. Serveur de jeu Minecraft (PaperMC 1.20.4, Java 21) : héberge la partie. Tourne sur une VM OpenNebula (Ubuntu 22.04, 8 Go). Le plugin de tâches/troc/désignation est à faire.
2. Agents LLM (bots Mineflayer, Node.js 22) : jouent exactement comme un joueur humain (client du jeu, chat, `/msg`), sans aucun droit sur le serveur. Voir [bots/README.md](bots/README.md).
3. Passerelle LiteLLM de l'université : seul point d'accès au modèle (Mistral Small 3.2 24B). Les bots limitent le débit, gèrent les erreurs et vérifient les réponses (function calling avec repli JSON).
4. Observabilité : chaque partie produit des journaux JSONL (appels au LLM avec tokens et temps de réponse, décisions, actions, chat, votes, carnet de l'IA). Le script Python `analyse/analyse_partie.py` en fait un résumé par agent. Les journaux et statistiques du serveur (`logs/`, `world/stats/`) complètent.
5. Client maître du jeu : prévu, pas encore commencé.

---

## Structure du depôt

```text
├── bots/                 # Agents LLM (Mineflayer + LiteLLM), voir bots/README.md
├── server/               # Configuration du serveur PaperMC (sans le monde ni les .jar)
├── analyse/              # Scripts Python d'analyse des parties
├── infra/                # Scripts de déploiement (archivage des journaux d'une partie)
├── docs/                 # Notes techniques
├── data/parties/         # Journaux des parties (jamais envoyés sur GitLab)
├── JOURNAL.md            # Journal de bord (suivi quotidien des avancées et decisions)
└── README.md             # Présentation et guide du depôt
```

---

## Installation et lancement

Serveur (sur la VM, utilisateur `minecraft`) : le serveur tourne en service `systemd --user` (`systemctl --user status minecraft`). Le `paper.jar` et le monde ne sont pas dans le dépôt.

Agents :
```bash
cd bots
npm install
cp .env.example .env        # renseigner l'adresse de la passerelle, la clé et le modèle (jamais commité)
npm test                    # tests hors ligne
npm run verifier-llm -- 20  # vérification du function calling et du JSON
npm start                   # lance les 3 agents de agents.json (npm start -- Joueur4 pour un seul)
```

Analyse d'une partie :
```bash
python analyse/analyse_partie.py data/parties/<id_partie>
./infra/archiver_partie.sh <id_partie>   # sur la VM : copie aussi les journaux du serveur
```

On travaille par branches (`feat/...`, `fix/...`) et on fusionne dans `main` une fois testé.

---

## Journal de Bord et Relevé de Temps
- Le suivi quotidien des decisions, tests et avancées est disponible dans JOURNAL.md.
- Le temps de travail de l'équipe doit être comptabilisé avec Kimai ou TimeTagger (pas encore en place).

---

## Equipe et Encadrement
- Etudiants (Groupe) : Matteo Godart, Ayoub Seghir, Yacine Mounsi
- Enseignants referents : Lydie Sandron, Ingrid Zmolnig, Frederic Blanchard
- Etablissement : IUT de Reims Champagne-Ardenne - BUT Informatique (Parcours DATAIA)