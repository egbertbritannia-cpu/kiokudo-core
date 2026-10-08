import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
import sys
sys.path.insert(0, str(SCRIPT_DIR))
import audit_snapshots as audit
import prepare_local_staging_clone as local_clone


def create_export(p):
    with sqlite3.connect(p) as cx:
        cx.executescript("""
            PRAGMA foreign_keys=ON;
            CREATE TABLE decks(id TEXT PRIMARY KEY,name TEXT NOT NULL);
            CREATE TABLE cards(id TEXT PRIMARY KEY,deck_id TEXT NOT NULL REFERENCES decks(id),
                due INTEGER NOT NULL,stability REAL NOT NULL,state TEXT NOT NULL);
            CREATE TABLE review_logs(id TEXT PRIMARY KEY,card_id TEXT REFERENCES cards(id),
                rating TEXT NOT NULL,review_time INTEGER NOT NULL);
            CREATE INDEX idx_cards_deck ON cards(deck_id);
            CREATE TRIGGER no_bad_rating BEFORE INSERT ON review_logs
            WHEN NEW.rating NOT IN ('Again','Hard','Good','Easy')
            BEGIN SELECT RAISE(ABORT,'invalid grade'); END;
            CREATE VIEW cards_with_deck AS SELECT c.id,d.name
                FROM cards c JOIN decks d ON d.id=c.deck_id;
            INSERT INTO decks VALUES ('jpd','JPD133');
            INSERT INTO cards VALUES ('original-card','jpd',1780000000,3.4,'Review');
            INSERT INTO review_logs VALUES ('original-review','original-card','Good',1770000000);
        """)


class CloneRehearsalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.src = self.folder / "baseline.db"
        self.out = self.folder / "stage.db"
        self.report = self.folder / "audit.json"
        create_export(self.src)
        self.sha = audit.inspect(str(self.src))["file_sha256"]
        self.marker = "local-clone-marker-unique-enough-00001"

    def clone(self):
        return local_clone.prepare_local_clone(
            str(self.src), str(self.out), str(self.report), self.marker, self.sha
        )

    def test_preserves_all_ids_history_indexes_views_triggers_and_source(self):
        result = self.clone()
        self.assertTrue(result["passed"], result)
        self.assertEqual(local_clone.file_digest(self.src), self.sha)
        self.assertEqual(result["baseline"]["tables"]["cards"]["count"], 1)
        with sqlite3.connect(self.out) as cx:
            self.assertEqual(cx.execute("SELECT id FROM cards").fetchone()[0], "original-card")
            self.assertEqual(cx.execute("SELECT id FROM review_logs").fetchone()[0], "original-review")
            self.assertEqual(cx.execute("SELECT marker FROM kiokudo_deployment_identity").fetchone()[0], self.marker)
            self.assertEqual(cx.execute("SELECT id,name FROM cards_with_deck").fetchall(), [("original-card","JPD133")])
            with self.assertRaises(sqlite3.IntegrityError):
                cx.execute("INSERT INTO review_logs VALUES ('bad','original-card','invalid',1)")
        self.assertTrue(self.report.is_file())
        self.assertEqual(self.report.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.out.stat().st_mode & 0o777, 0o600)

    def test_wrong_checksum_cannot_create_clone_or_report(self):
        with self.assertRaisesRegex(ValueError, "checksum"):
            local_clone.prepare_local_clone(str(self.src),str(self.out),str(self.report),self.marker,"0"*64)
        self.assertFalse(self.out.exists())
        self.assertFalse(self.report.exists())

    def test_rejects_overwrite_and_cannot_modify_source(self):
        self.clone()
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.clone()
        with self.assertRaises(ValueError):
            local_clone.prepare_local_clone(str(self.src),str(self.src),str(self.folder/"again.json"),self.marker,self.sha)
        self.assertEqual(local_clone.file_digest(self.src),self.sha)

    def test_fails_on_broken_fk_before_output_creation(self):
        with sqlite3.connect(self.src) as cx:
            cx.execute("PRAGMA foreign_keys=OFF")
            cx.execute("UPDATE cards SET deck_id='nonexistent'")
        sha=local_clone.file_digest(self.src)
        with self.assertRaisesRegex(ValueError, "foreign_key_check"):
            local_clone.prepare_local_clone(str(self.src),str(self.out),str(self.report),self.marker,sha)
        self.assertFalse(self.out.exists())

    def test_rejects_fixture_marker_and_remote_path(self):
        with self.assertRaisesRegex(ValueError, "marker"):
            local_clone.prepare_local_clone(str(self.src),str(self.out),str(self.report),
                local_clone.FIXTURE_MARKER,self.sha)
        with self.assertRaisesRegex(ValueError, "local file path"):
            local_clone.prepare_local_clone(str(self.src),"libsql://remote.turso.io",
                str(self.report),self.marker,self.sha)

    def test_local_rollback_is_discard_and_reclone_from_same_export(self):
        self.clone()
        with sqlite3.connect(self.out) as cx:
            cx.execute("UPDATE cards SET state='Relearning'")
            cx.execute("INSERT INTO review_logs VALUES ('new','original-card','Hard',1780000000)")
        dirty=audit.compare(audit.inspect(str(self.src)),audit.inspect(str(self.out)))
        self.assertFalse(dirty["passed"])
        self.out.unlink()
        self.report.unlink()
        again=self.clone()
        self.assertTrue(again["passed"])
        with sqlite3.connect(self.out) as cx:
            self.assertEqual(cx.execute("SELECT COUNT(*) FROM review_logs").fetchone()[0], 1)

    def test_rejects_already_marked_baseline(self):
        with sqlite3.connect(self.src) as cx:
            cx.execute("CREATE TABLE kiokudo_deployment_identity(environment TEXT PRIMARY KEY,marker TEXT NOT NULL)")
            cx.execute("INSERT INTO kiokudo_deployment_identity VALUES ('staging','other')")
        sha=local_clone.file_digest(self.src)
        with self.assertRaisesRegex(ValueError, "already carries"):
            local_clone.prepare_local_clone(str(self.src),str(self.out),str(self.report),self.marker,sha)


if __name__ == "__main__":
    unittest.main()
