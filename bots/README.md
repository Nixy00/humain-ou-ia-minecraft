# Agents LLM (Mineflayer + LiteLLM)

Chaque agent est un joueur Minecraft normal (client Mineflayer, chat, `/msg`), sans droit
d'administration ni accès au serveur. Ses décisions viennent d'un LLM appelé uniquement via la
passerelle LiteLLM.

## Lancement

```bash
cd bots
npm install
cp .env.example .env        # renseigner LITELLM_BASE_URL, LITELLM_API_KEY, LLM_MODEL
npm test                    # tests hors ligne (passerelle simulée)
npm run verifier-llm -- 20  # vérification semaine 1 : function calling et JSON, 20 essais par mode
npm start                   # lance les agents de agents.json
npm start -- Joueur4        # lance un seul agent
```

## Organisation

| Fichier | Rôle |
|---|---|
| `index.js` | Lanceur : lit `agents.json`, crée la passerelle et le journal partagés, étale les connexions |
| `src/config.js` | Paramètres lus dans `.env` |
| `src/llm/gateway.js` | Client LiteLLM : limitation du débit, délai maximal, nouvelles tentatives (429/5xx), mesure latence/jetons/coût |
| `src/llm/structured.js` | Obtenir un appel d'outil valide : function calling, ou repli JSON ; relance si format invalide |
| `src/llm/schema.js` | Validation des arguments renvoyés par le modèle |
| `src/agent/perception.js` | État du jeu vu par le client -> texte pour le modèle |
| `src/agent/actions.js` | Outils proposés au modèle et leur exécution Mineflayer |
| `src/agent/prompt.js` | Consignes système, prompt de tour, prompt de désignation |
| `src/agent/humanizer.js` | Ce qui rend les bots moins parfaits : délais, fautes de frappe, coups ratés |
| `src/agent/reflexes.js` | Réflexes sans LLM : se défendre, ne pas se noyer, se débloquer, regarder autour |
| `src/agent/agent.js` | Boucle évènement -> perception -> décision -> action, votes, reconnexion |
| `src/observability/logger.js` | Journaux JSONL de la partie |

## Personnalités et façon de parler

Chaque bot a une personnalité tirée des types de joueurs de Bartle (1996) et des réglages dans
`agents.json` (`persona` = texte donné au modèle, `style` = réglages du comportement).

| Bot | Type | Comment il joue | Comment il parle |
|---|---|---|---|
| Joueur4 | Socializer | vient discuter, propose des échanges, aide | court, un peu d'humour, "pierre", "table de craft", "diams", mdr/tkt rarement |
| Joueur5 | Achiever | veut finir les tâches, efficace mais pas parfait | 1 à 3 mots, vocabulaire de joueur expérimenté : "cobble", "stuff", "full fer", "stack" |
| Joueur6 | Explorer | explore, se débrouille, pose des questions sur le reste | français simple, presque pas d'argot : "établi", "grotte", "minerai" |

Réglages de `style` (par bot) :

| Réglage | Sens | Joueur4 | Joueur5 | Joueur6 |
|---|---|---|---|---|
| `secondesParLettre` | vitesse de frappe | 0.22 | 0.2 | 0.28 |
| `bavard` | chance de réagir à un message qui ne lui est pas adressé | 0.7 | 0.25 | 0.45 |
| `fautes` | chance de faire une faute de frappe (parfois corrigée par "*mot") | 0.08 | 0.04 | 0.06 |
| `rateCoup` | chance de rater un coup | 0.25 | 0.15 | 0.3 |
| `accents` | chance de garder les accents d'un mot | 0.15 | 0.1 | 0.35 |

Règles communes du chat (d'après 1000 messages d'un vrai serveur et le test de Turing de Jones et Bergen) :

- messages courts : la plupart font 1 à 3 mots, un message de plus de 12 mots est refusé et le modèle reformule ;
- argot rare (environ 1 message sur 20), minuscules, pas de point final, apostrophe clavier ;
- pas d'identifiant technique dans le chat (`oak_log` est refusé, on dit "bois") ;
- pas de répétition d'un des 3 derniers messages ;
- délai avant chaque message : 1 s + temps de frappe + temps de lecture + réflexion (12 s max) ;
- ne répond pas à tout : toujours si on l'appelle par son nom, sinon selon `bavard`.

Tout le comportement "humain" se coupe avec `AGENT_HUMANIZE=false` pour comparer avec et sans.

## Données produites (`data/parties/<GAME_ID>/`)

`llm_calls.jsonl`, `decisions.jsonl`, `actions.jsonl`, `events.jsonl`, `votes.jsonl`, `errors.jsonl`.
Le champ `decision_id` relie une action ou un message du jeu aux appels LLM qui l'ont produit
(`llm_call_ids`). Les métadonnées envoyées à LiteLLM (`session_id` = partie, `trace_id` = décision)
permettent de retrouver les mêmes appels dans Langfuse si la passerelle y est reliée.

## Points à régler avec le plugin de jeu

- Annonce des désignations : message serveur reconnu par `VOTE_TRIGGER`.
- Commande de vote : `VOTE_COMMAND`, qui doit être la même que pour les humains.
- Pseudonymes : les agents et les humains doivent recevoir des pseudos du même format
  (ex. `Joueur1` à `Joueur6`, tirés au hasard), sinon le nom seul trahit les agents.
