import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "scripts" / "audit_snapshots.py"
spec = importlib.util.spec_from_file_location("audit_snapshots", MODULE)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def build_file(path, include_marker=False):
    cx = sqlite3.connect(path)
    cx.executescript("""
        CREATE TABLE decks (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE cards (id TEXT PRIMARY KEY, deck_id TEXT REFERENCES decks(id),
          state TEXT NOT NULL, stability REAL NOT NULL);
        CREATE TABLE review_logs (id TEXT PRIMARY KEY,card_id TEXT REFERENCES cards(id),
          rating TEXT NOT NULL);
        CREATE INDEX cards_by_deck ON cards(deck_id);
        INSERT INTO decks VALUES ('deck_1','Japanese');
        INSERT INTO cards VALUES ('card_1','deck_1','Review',3.2);
        INSERT INTO review_logs VALUES ('evt_1','card_1','Good');
    """)
    if include_marker:
        cx.execute("CREATE TABLE kiokudo_deployment_identity (environment TEXT PRIMARY KEY,marker TEXT)")
        cx.execute("INSERT INTO kiokudo_deployment_identity VALUES ('staging','separate-safe-marker')")
    cx.commit()
    cx.close()


class SnapshotAuditTests(unittest.TestCase):
    def test_exact_copy_with_staging_marker_passes(self):
        with tempfile.TemporaryDirectory() as d:
            a,b = Path(d)/"baseline.db", Path(d)/"stage.db"
            build_file(a)
            build_file(b,True)
            digest_before = audit.inspect(str(a))["file_sha256"]
            report = audit.compare(audit.inspect(str(a)),audit.inspect(str(b)))
            self.assertTrue(report["passed"],report)
            self.assertEqual(audit.inspect(str(a))["file_sha256"],digest_before)

    def test_changed_review_history_blocks_cutover(self):
        with tempfile.TemporaryDirectory() as d:
            a,b = Path(d)/"baseline.db", Path(d)/"stage.db"
            build_file(a)
            build_file(b,True)
            cx=sqlite3.connect(b)
            cx.execute("UPDATE review_logs SET rating='Hard' WHERE id='evt_1'")
            cx.commit(); cx.close()
            result=audit.compare(audit.inspect(str(a)),audit.inspect(str(b)))
            self.assertFalse(result["passed"])
            self.assertIn({"table":"review_logs","kind":"sha256",
                           "baseline":result["baseline"]["tables"]["review_logs"]["sha256"],
                           "staging":result["staging"]["tables"]["review_logs"]["sha256"]},
                          result["differences"])

    def test_missing_identity_blocks(self):
        with tempfile.TemporaryDirectory() as d:
            a,b=Path(d)/"baseline.db",Path(d)/"stage.db"
            build_file(a);build_file(b)
            result=audit.compare(audit.inspect(str(a)),audit.inspect(str(b)))
            self.assertFalse(result["passed"])

    def test_changed_schema_blocks(self):
        with tempfile.TemporaryDirectory() as d:
            a,b=Path(d)/"baseline.db",Path(d)/"stage.db"
            build_file(a);build_file(b,True)
            cx=sqlite3.connect(b);cx.execute("CREATE INDEX extra ON cards(state)");cx.close()
            result=audit.compare(audit.inspect(str(a)),audit.inspect(str(b)))
            self.assertFalse(result["passed"])
            self.assertTrue(any(d["kind"]=="indexes" for d in result["differences"]))

    def test_incomplete_schema_not_accepted_even_if_files_identical(self):
        with tempfile.TemporaryDirectory() as d:
            a,b=Path(d)/"baseline.db",Path(d)/"stage.db"
            for f in (a,b):
                cx=sqlite3.connect(f);cx.execute("CREATE TABLE decks (id TEXT PRIMARY KEY)");cx.close()
            result=audit.compare(audit.inspect(str(a)),audit.inspect(str(b)))
            self.assertFalse(result["passed"])


if __name__=="__main__":
    unittest.main()
