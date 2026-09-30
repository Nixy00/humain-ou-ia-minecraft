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
| `src/agent/humanizer.js` | Délais de réaction et de frappe (paramètre expérimental) |
| `src/agent/agent.js` | Boucle évènement -> perception -> décision -> action, votes, reconnexion |
| `src/observability/logger.js` | Journaux JSONL de la partie |

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
