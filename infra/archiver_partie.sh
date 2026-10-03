#!/bin/bash
# Copie les journaux du serveur Minecraft dans le dossier d'une partie (avec ceux des agents),
# pour pouvoir rejouer et analyser la partie ensuite.
# Usage (sur la VM, depuis le dossier du dépôt) : ./infra/archiver_partie.sh <id_partie>
# Attention : ces journaux contiennent les vrais pseudos (et les IP si log-ips=true),
# ils restent dans data/parties/ qui n'est jamais envoyé sur GitLab.
set -e
if [ -z "$1" ]; then echo "Usage : $0 <id_partie>"; exit 1; fi
LOGS=${SERVEUR_LOGS:-/home/minecraft/sae-s5/server/logs}
DEST=data/parties/$1/serveur
mkdir -p "$DEST"
cp "$LOGS"/latest.log "$DEST"/
cp "$LOGS"/*.log.gz "$DEST"/ 2>/dev/null || true
echo "Journaux du serveur copiés dans $DEST"
