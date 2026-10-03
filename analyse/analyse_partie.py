"""Résumé d'une partie à partir des journaux des agents (data/parties/<id>/*.jsonl).

Pour chaque agent : appels au LLM (tokens, temps de réponse, réponses invalides),
décisions (ce qui les a déclenchées), actions (réussies / ratées) et messages du chat.

Usage : python analyse/analyse_partie.py data/parties/<id>
Écrit aussi resume.json dans le dossier de la partie.
"""
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path


def lire(dossier, nom):
    fichier = Path(dossier) / f"{nom}.jsonl"
    if not fichier.exists():
        return []
    return [json.loads(ligne) for ligne in fichier.read_text(encoding="utf-8").splitlines() if ligne.strip()]


def mediane(valeurs):
    return statistics.median(valeurs) if valeurs else None


def resumer(dossier):
    appels = lire(dossier, "llm_calls")
    decisions = lire(dossier, "decisions")
    actions = lire(dossier, "actions")
    notes = lire(dossier, "notes")

    agents = sorted({a["agent"] for a in appels + decisions + actions if "agent" in a})
    resume = {}
    for agent in agents:
        ses_appels = [a for a in appels if a.get("agent") == agent and a.get("usage")]
        ses_actions = [a for a in actions if a.get("agent") == agent]
        messages = [a["args"]["message"] for a in ses_actions if a["tool"] in ("parler", "murmurer") and a.get("ok")]

        resume[agent] = {
            "appels_llm": len([a for a in appels if a.get("agent") == agent]),
            "reponses_invalides": len([a for a in appels if a.get("agent") == agent and a.get("valid") is False]),
            "tokens_question": sum(a["usage"]["prompt_tokens"] for a in ses_appels),
            "tokens_reponse": sum(a["usage"]["completion_tokens"] for a in ses_appels),
            "latence_mediane_ms": mediane([a["latency_ms"] for a in ses_appels]),
            "declencheurs": dict(Counter(d["reason"].split(" (")[0] for d in decisions if d.get("agent") == agent)),
            "actions_reussies": dict(Counter(a["tool"] for a in ses_actions if a.get("ok"))),
            "actions_ratees": dict(Counter(a["tool"] for a in ses_actions if not a.get("ok"))),
            "messages": len(messages),
            "mots_par_message_mediane": mediane([len(m.split()) for m in messages]),
            "delai_humain_median_ms": mediane([a["humanize_delay_ms"] for a in ses_actions if a.get("humanize_delay_ms")]),
            "notes": [n["note"] for n in notes if n.get("agent") == agent],
        }
    return resume


def afficher(resume):
    for agent, r in resume.items():
        total = r["tokens_question"] + r["tokens_reponse"]
        print(f"== {agent}")
        print(f"   appels LLM : {r['appels_llm']} (dont {r['reponses_invalides']} invalides), tokens : {total}, "
              f"temps de réponse médian : {r['latence_mediane_ms']} ms")
        print(f"   déclenché par : {r['declencheurs']}")
        print(f"   actions réussies : {r['actions_reussies']}")
        print(f"   actions ratées : {r['actions_ratees']}")
        print(f"   messages : {r['messages']} (médiane {r['mots_par_message_mediane']} mots), "
              f"délai avant envoi médian : {r['delai_humain_median_ms']} ms")
        print(f"   carnet : {len(r['notes'])} notes")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage : python analyse/analyse_partie.py data/parties/<id>")
    dossier = sys.argv[1]
    resume = resumer(dossier)
    afficher(resume)
    (Path(dossier) / "resume.json").write_text(json.dumps(resume, ensure_ascii=False, indent=2), encoding="utf-8")
