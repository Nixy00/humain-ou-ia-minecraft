#!/bin/bash
# Lance chaque bot dans son propre programme (un processus par bot, comme Mindcraft) :
# un bot qui calcule un long chemin ne fige plus les autres, chacun a sa file d'appels au modèle,
# et si l'un plante il redémarre seul sans faire tomber les deux autres.
#
# Utilisation : ./lancer.sh                      -> Joueur4, Joueur5 et Joueur6
#               ./lancer.sh Joueur4 Joueur6      -> seulement ceux-là
#               timeout 3600 ./lancer.sh         -> arrêt automatique au bout d'une heure
# Les journaux de la partie sont dans data/parties/$GAME_ID/ (un fichier par bot : actions-Joueur4.jsonl...).
# Attention : LLM_BUDGET_TOKENS (.env) compte maintenant pour CHAQUE bot.

cd "$(dirname "$0")"
export GAME_ID="${GAME_ID:-partie-$(date +%m%d-%H%M)}"
BOTS="${*:-Joueur4 Joueur5 Joueur6}"

# À l'arrêt (fin du timeout, Ctrl+C), on arrête tout le groupe : les boucles ET les programmes node des bots
# (arrêter seulement les boucles laissait les bots connectés).
trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT

lancer_un_bot() {
  while true; do
    node index.js "$1"
    echo "[$1] programme arrêté, redémarrage dans 10 s"
    sleep 10
  done
}

echo "Partie $GAME_ID : bots $BOTS"
for bot in $BOTS; do
  lancer_un_bot "$bot" &
  sleep $((RANDOM % 15 + 3)) # arrivées étalées : des connexions simultanées trahiraient les bots
done
wait
