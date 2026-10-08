"""Rythme du chat de vrais joueurs Minecraft, pour régler nos bots.

Jeu de données : "Minecraft Server Chat" (Hugging Face, declip/Minecraft-Server-Chat, licence CC0),
2,66 millions de messages avec le texte, le pseudo et l'heure (à la minute près).
On prend une tranche de messages qui se suivent (par défaut 6 000 à partir du n° 500 000).

Utilisation : python analyse/rythme_chat.py [debut] [nombre]
"""
import json
import re
import sys
import time
import urllib.request
from collections import Counter
from datetime import datetime

URL = "https://datasets-server.huggingface.co/rows?dataset=declip/Minecraft-Server-Chat&config=default&split=train&offset={}&length=100"


def telecharger(debut, nombre):
    lignes = []
    for off in range(debut, debut + nombre, 100):
        for essai in range(3):
            try:
                d = json.load(urllib.request.urlopen(URL.format(off), timeout=30))
                lignes += [r["row"] for r in d["rows"]]
                break
            except Exception:
                time.sleep(2)
    return lignes


def pourcent(n, total):
    return round(100 * n / max(total, 1))


def main():
    debut = int(sys.argv[1]) if len(sys.argv) > 1 else 500000
    nombre = int(sys.argv[2]) if len(sys.argv) > 2 else 6000
    msgs = [r for r in telecharger(debut, nombre) if r["username"] and r["content"]]
    for m in msgs:
        m["t"] = datetime.strptime(m["date"], "%m/%d/%Y %I:%M %p")
    joueurs = Counter(m["username"] for m in msgs)
    noms = {u.lower() for u in joueurs}
    print(f"{len(msgs)} messages, {len(joueurs)} joueurs")

    # Rafales : combien de messages un joueur envoie d'affilée.
    rafales, n = [], 1
    for a, b in zip(msgs, msgs[1:]):
        if a["username"] == b["username"]:
            n += 1
        else:
            rafales.append(n)
            n = 1
    print("message isolé (pas de rafale) :", pourcent(rafales.count(1), len(rafales)), "%")

    # Écart entre deux messages d'un même joueur (minutes).
    dernier, ecarts = {}, []
    for m in msgs:
        if m["username"] in dernier:
            ecarts.append((m["t"] - dernier[m["username"]]).total_seconds() / 60)
        dernier[m["username"]] = m["t"]
    ecarts.sort()
    print("écart médian entre 2 messages d'un joueur :", ecarts[len(ecarts) // 2], "min ; même minute :", pourcent(sum(e == 0 for e in ecarts), len(ecarts)), "%")

    def cites(m):
        mots = set(re.findall(r"[a-z0-9_]{3,}", m["content"].lower()))
        return [u for u in joueurs if u.lower() in mots and u != m["username"]]

    print("cite un autre joueur :", pourcent(sum(bool(cites(m)) for m in msgs), len(msgs)), "%")
    print("pose une question :", pourcent(sum("?" in m["content"] for m in msgs), len(msgs)), "%")

    # Un joueur cité répond-il dans les 2 minutes ?
    repond = total = 0
    for i, m in enumerate(msgs):
        for u in cites(m):
            total += 1
            repond += any(x["username"] == u and 0 <= (x["t"] - m["t"]).total_seconds() <= 120 for x in msgs[i + 1:i + 60])
    print("joueur cité qui répond dans les 2 min :", pourcent(repond, total), f"% (sur {total})")

    mots = sorted(len(m["content"].split()) for m in msgs)
    print("mots par message : médiane", mots[len(mots) // 2], "; plus de 6 mots :", pourcent(sum(x > 6 for x in mots), len(mots)), "%")


if __name__ == "__main__":
    main()
