"""Test du résumé de partie sur une petite partie inventée. Lancer avec : python -m unittest analyse/test_analyse_partie.py"""
import json
import tempfile
import unittest
from pathlib import Path

from analyse_partie import resumer


def ecrire(dossier, nom, lignes):
    (Path(dossier) / f"{nom}.jsonl").write_text("\n".join(json.dumps(l) for l in lignes), encoding="utf-8")


class TestResume(unittest.TestCase):
    def test_partie_simple(self):
        with tempfile.TemporaryDirectory() as d:
            ecrire(d, "llm_calls", [
                {"agent": "Joueur4", "valid": True, "usage": {"prompt_tokens": 100, "completion_tokens": 10}, "latency_ms": 400},
                {"agent": "Joueur4", "valid": False, "usage": {"prompt_tokens": 100, "completion_tokens": 10}, "latency_ms": 600},
            ])
            ecrire(d, "decisions", [{"agent": "Joueur4", "reason": "message de SAHYGO"}])
            ecrire(d, "actions", [
                {"agent": "Joueur4", "tool": "parler", "ok": True, "args": {"message": "jarrive"}, "humanize_delay_ms": 2000},
                {"agent": "Joueur4", "tool": "collecter", "ok": False, "args": {}},
            ])
            r = resumer(d)["Joueur4"]
            self.assertEqual(r["appels_llm"], 2)
            self.assertEqual(r["reponses_invalides"], 1)
            self.assertEqual(r["tokens_question"], 200)
            self.assertEqual(r["latence_mediane_ms"], 500)
            self.assertEqual(r["actions_ratees"], {"collecter": 1})
            self.assertEqual(r["mots_par_message_mediane"], 1)


if __name__ == "__main__":
    unittest.main()


def test_fusionne_les_fichiers_de_chaque_bot(tmp_path):
    # Avec lancer.sh, chaque bot écrit ses propres fichiers (actions-Joueur4.jsonl...) : la lecture les fusionne.
    from analyse_partie import lire
    (tmp_path / "actions-Joueur4.jsonl").write_text(json.dumps({"ts": "2", "agent": "Joueur4"}), encoding="utf-8")
    (tmp_path / "actions-Joueur5.jsonl").write_text(json.dumps({"ts": "1", "agent": "Joueur5"}), encoding="utf-8")
    assert [l["agent"] for l in lire(tmp_path, "actions")] == ["Joueur5", "Joueur4"]
