# Handoff : reprendre le projet

Ce document sert à reprendre le projet sans avoir suivi toutes les séances. Il complète le
[README](../README.md) (présentation, installation) et le [JOURNAL](../JOURNAL.md) (le détail de
chaque décision, avec les chiffres). État au 22 octobre 2026.

## 1. En une minute

- Un serveur Minecraft Paper 1.20.4 tourne sur notre VM. 3 bots (Joueur4, Joueur5, Joueur6) y jouent
  comme des joueurs normaux (Mineflayer), pilotés par le modèle de la passerelle LiteLLM de l'université.
- Ce qui marche : se déplacer, miner, fabriquer, construire, parler dans le chat en se répondant,
  se demander des objets, réfléchir toutes les 3 minutes, tout est journalisé.
- Ce qui ne marche pas encore bien : coopérer jusqu'au bout (les promesses ne sont pas toujours
  tenues), construire de grosses structures proprement, rester crédible longtemps dans le chat.
- Pas encore commencé : le plugin (tâches à faire ensemble, désignations humain / IA), les tests avec
  des volontaires, les conteneurs, le relevé de temps, la vidéo en anglais.

## 2. Accès et sécurité

| Quoi | Où |
|---|---|
| VM | `10.31.32.92`, joignable seulement avec le VPN de l'université |
| Connexion | `ssh root@10.31.32.92` avec une clé (demander à Ayoub d'ajouter la vôtre) |
| Utilisateur du jeu | `minecraft` (le serveur et les bots tournent sous cet utilisateur) |
| Serveur en jeu | `10.31.32.92:25565`, mode hors ligne (n'importe quel pseudo) |
| Clé de la passerelle | seulement dans `bots/.env` (sur la VM et sur nos PC), jamais dans GitLab |
| Mot de passe RCON | seulement sur la VM, dans `/root/rcon_cmd.py` |

Règles : on ne met jamais la clé, l'adresse de la passerelle ou le modèle dans le code ; on
pseudonymise les données des volontaires (`log-ips=false` sur le serveur).

## 3. Sur la VM

| Chemin | Rôle |
|---|---|
| `/home/minecraft/sae-s5/server/` | le serveur qui tourne (service `systemctl --user` nommé `minecraft`) |
| `/home/minecraft/sae-s5-ia/` | notre dépôt (le code des bots qui tourne) |
| `/home/minecraft/sae-s5-ia/data/parties/<partie>/` | les journaux de chaque partie |
| `/home/minecraft/sae-s5-ia/bots/structures/` | la bibliothèque de structures inventées par les bots |
| `/home/minecraft/sauvegardes/` | les anciens mondes |
| `/home/minecraft/changer-monde.sh` | changer de monde : `changer-monde.sh <dossier> <normal ou flat> <survival ou creative>` |
| `/home/minecraft/lancer-test.sh` | lancer un scénario : `lancer-test.sh <nom> [durée en s]` |
| `/home/minecraft/lancer-equipe.sh` | le test en équipe (maison et ferme, 1 h) |
| `/root/rcon_cmd.py` | envoyer une commande au serveur : `python3 /root/rcon_cmd.py "time set day"` |

Mondes déjà créés : `world` (marais de mangroves), `plat` (map plate, créatif), `chaine` (normal, survie).

La VM n'a pas d'accès à GitLab (pas d'identifiants) : on copie le code depuis un PC, par exemple
`tar -cf - bots/src | ssh root@10.31.32.92 'cd /home/minecraft/sae-s5-ia && tar -xf - && chown -R minecraft: bots'`.

## 4. Lancer et arrêter les bots

```bash
# sur la VM, en tant que minecraft
cd /home/minecraft && setsid nohup ./lancer-test.sh structures 600 > test.out 2>&1 < /dev/null &
```

- `bots/lancer.sh` lance un programme par bot et le relance s'il plante.
- Pour tout arrêter : `pkill -f "[l]ancer.sh"; pkill -f "^node index.js"`. Sans le premier, la boucle
  relance les bots au bout de 10 s (un bot de test s'est fait éjecter à cause de ça). Les crochets
  évitent que `pkill` lancé par ssh tue sa propre commande.
- Sur un PC : `cd bots && npm install && npm test` (69 tests, sans serveur ni passerelle).

## 5. Comment marche un bot

Chaque bot a plusieurs "têtes", chacune est un appel séparé au modèle (`bots/src/agent/agent.js`) :

| Tête | Rôle | Quand |
|---|---|---|
| Réflexes | se défendre, fuir, ne pas se noyer (code, sans modèle) | toutes les 100 ms |
| Parole | répondre dans le chat (`repond_a`, `dire`, `engagement`) | quand on lui parle |
| Actions | choisir une action parmi 34 outils (`actions.js`) | à la fin de chaque action |
| Réflexion | résumé, avis sur les autres, objectif | toutes les 3 minutes |
| Plan | la prochaine étape pour obtenir un objet (`plan.js`, code) | à chaque décision |

Les personnalités (vie d'étudiant, caractère, répliques, objectifs) sont dans `bots/agents.json`.
Le détail des fichiers est dans [bots/README.md](../bots/README.md).

## 6. Les scénarios de test

Un scénario est un fichier `bots/tests/<nom>.json`, lancé avec `AGENT_TEST=tests/<nom>.json`
(c'est ce que fait `lancer-test.sh`). Il remplace l'objectif d'équipe et complète chaque bot :

```json
{
  "equipe": "texte montré à tous les bots",
  "bots": {
    "Joueur5": { "role": "...", "mission": "...", "objectifs": ["iron_pickaxe"], "interdits": ["_log"], "outilsInterdits": ["creuser"] }
  }
}
```

`interdits` = blocs qu'il n'a pas le droit de récolter (il doit les demander), `outilsInterdits` =
actions refusées. Scénarios existants : `creatif-libre`, `structures`, `chaine`.

## 7. Journaux et analyse

Chaque partie écrit dans `data/parties/<partie>/` un fichier par type et par bot :
`llm_calls-Joueur4.jsonl` (chaque appel au modèle), `decisions-*`, `actions-*`, `events-*` (chat,
morts...), `etat-*` (vie, inventaire), `notes-*`.

```bash
python3 analyse/analyse_partie.py data/parties/<partie>    # résumé par bot
cd bots && node scripts/raisonnements.js ../data/parties/<partie> [Joueur5]   # réflexions et pensées
```

`analyse/rythme_chat.py` mesure le chat de vrais joueurs (jeu de données public CC0), pour comparer
avec nos bots.

## 8. Git

- Dépôt : GitLab `goda0054/sae-s5`. On travaille sur des branches `feat/...` ou `fix/...`.
- On ne supprime pas les branches (le prof doit voir le travail par branche).
- `main` est resté au 4 octobre : toutes les branches depuis sont à fusionner après relecture.
  Branche la plus récente : `feat/tests-scenarios` (elle contient toutes les précédentes).
- Commits courts en français : `feat: ...`, `fix: ...`, `docs: ...`, une étape validée par commit.
- Le journal (`JOURNAL.md`) est mis à jour à chaque séance : il sert de base aux notes techniques.

## 9. Derniers résultats et problèmes connus

| Test (22/10) | Résultat |
|---|---|
| Équipe, maison et ferme (1 h) | ils se parlent et se répartissent le travail, mais ni maison ni ferme (spawn dans un marais, promesses d'objets qu'ils n'ont pas) |
| Créatif libre (10 min) | ils inventent des structures (tour de guet, abri, maison d'équipe), mais reconstruisaient la même en boucle et se croyaient sous terre sur la map plate (corrigé) |
| Structures demandées (10 min) | petite maison, grande maison et tour en partie construites ; voir le journal |
| Chaîne bois, fer, diamant (30 min) | voir le journal |

Problèmes connus :
- Un plan de structure se pose là où est le bot : s'il bouge et relance, il rebâtit plus loin.
- Des blocs n'arrivent pas à être posés (bloc flottant, bot dans le chemin).
- En créatif, ils gardent des réflexes de survie (collecter, demander de la pierre).
- Tics de langage ("frero" dans 24 % des messages au banc d'essai), à surveiller.
- Volume : environ 30 appels par minute pour 3 bots (4,2 millions de tokens en 1 h). M. Blanchard l'a remarqué, c'est voulu.

## 10. Prochaines étapes

1. Note technique intermédiaire (restitution en semaine 43).
2. Corriger les structures (garder l'emplacement d'une structure, ajouter des pièces à une structure existante).
3. Repenser les rôles en préférences : tout le monde peut miner et construire, chacun le fait plus ou moins.
4. Le plugin : tâches à faire ensemble, désignations humain / IA (`/designer`), journal côté serveur.
5. Protocole avec des volontaires (consentement, pseudonymisation), puis parties mixtes humains et bots.
6. Conteneurs (Docker), relevé de temps (Kimai ou Time Tagger), vidéo en anglais, note finale.
7. Soutenance le vendredi 27 novembre.

## 11. À lire en premier

1. Le sujet (PDF des enseignants), section du sujet 5 et règles communes.
2. Ce fichier, puis le [README](../README.md) et [bots/README.md](../bots/README.md).
3. [JOURNAL.md](../JOURNAL.md), surtout à partir du 9 octobre.
4. [docs/reactions-des-bots.md](reactions-des-bots.md) : les cas de chat testés et les réponses attendues.
