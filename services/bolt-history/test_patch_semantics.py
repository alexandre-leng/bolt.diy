"""Prove the two PATCH-semantics behaviours against a real database.

Scenario A (omitted field): a save that does not carry `description` must KEEP the stored
title — the bug was that it erased it.

Scenario B (explicitly cleared): a save that sends `description: ""` must actually CLEAR it.
Before, both cases were indistinguishable and preserving was the only safe choice; now the
presence of the key decides.

Also proves the projects key change: two owners may hold the same slug.
"""
import importlib
import json
import os
import subprocess
import sys
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

TEST_DB = os.environ.get("BOLT_HISTORY_TEST_DB", "bolt_history_test_autoedit")
os.environ["BOLT_HISTORY_PG_DB"] = TEST_DB
os.environ.setdefault("BOLT_HISTORY_MIGRATIONS", "/opt/bolt/history/migrations")
sys.path.insert(0, "/opt/bolt/history")

bh = importlib.import_module("bolt_history")


def psql(sql, fetch=True):
    env = dict(os.environ, PGPASSWORD=bh.PG_PASSWORD)
    args = ["psql", "-h", bh.PG_HOST, "-p", str(bh.PG_PORT), "-U", bh.PG_USER, "-d", TEST_DB,
            "-v", "ON_ERROR_STOP=1", "-tAc", sql]
    r = subprocess.run(args, capture_output=True, text=True, env=env)

    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())

    return [line for line in r.stdout.split("\n") if line != ""]


def boot():
    exists = subprocess.run(
        ["psql", "-h", bh.PG_HOST, "-p", str(bh.PG_PORT), "-U", bh.PG_USER, "-d", "postgres",
         "-tAc", "SELECT 1 FROM pg_database WHERE datname='%s'" % TEST_DB],
        capture_output=True, text=True, env=dict(os.environ, PGPASSWORD=bh.PG_PASSWORD),
    )

    if exists.stdout.strip() != "1":
        subprocess.run(["createdb", "-h", bh.PG_HOST, "-p", str(bh.PG_PORT), "-U", bh.PG_USER, TEST_DB],
                       env=dict(os.environ, PGPASSWORD=bh.PG_PASSWORD), check=True)


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        boot()
        # `users` belongs to bolt-accounts' migrations, which a fresh history database does
        # not have. The suite needs owner rows to point at, so create the minimal table.
        psql("""
            CREATE TABLE IF NOT EXISTS users (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                email text UNIQUE,
                password_hash text,
                created_at timestamptz NOT NULL DEFAULT now()
            );
        """)
        bh.init_schema()
        psql("DELETE FROM projects;")
        psql("DELETE FROM chats;")
        psql("DELETE FROM users WHERE email LIKE 'autoedit%';")
        cls.owner = psql(
            "INSERT INTO users (email, password_hash) VALUES ('autoedit-1@x.fr','x') RETURNING id"
        )[0]
        cls.other = psql(
            "INSERT INTO users (email, password_hash) VALUES ('autoedit-2@x.fr','x') RETURNING id"
        )[0]
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), bh.Handler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        psql("DELETE FROM chats;")
        psql("DELETE FROM projects;")

    def call(self, method, path, body=None, owner=None):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Content-Type": "application/json"}
        who = owner or self.owner

        if who:
            headers["X-Bolt-User-Id"] = who

        conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
        resp = conn.getresponse()
        raw = resp.read().decode()
        conn.close()

        return resp.status, (json.loads(raw) if raw else None)


class PartialPatchSemantics(Base):
    def test_an_omitted_description_keeps_the_stored_title(self):
        self.call("PUT", "/history/c1", {
            "id": "c1", "urlId": "2-c1-0", "description": "Titre original",
            "timestamp": "2026-01-01T00:00:00Z", "messages": [{"id": "m1", "role": "user", "parts": []}],
        })
        # A later save that simply does not carry a title.
        status, _ = self.call("PUT", "/history/c1", {
            "id": "c1", "timestamp": "2026-01-02T00:00:00Z",
            "messages": [{"id": "m1", "role": "user", "parts": []}],
        })
        self.assertEqual(status, 200)
        stored = psql("SELECT description FROM chats WHERE id='c1';")
        self.assertEqual(stored, ["Titre original"], "an omitted title must not erase the stored one")
        # The urlId must survive too.
        self.assertEqual(psql("SELECT url_id FROM chats WHERE id='c1';"), ["2-c1-0"])

    def test_an_explicit_empty_string_really_clears_the_title(self):
        self.call("PUT", "/history/c2", {
            "id": "c2", "urlId": "2-c2-0", "description": "A effacer",
            "timestamp": "2026-01-01T00:00:00Z", "messages": [{"id": "m1", "role": "user", "parts": []}],
        })
        status, _ = self.call("PUT", "/history/c2", {
            "id": "c2", "description": "",
            "timestamp": "2026-01-02T00:00:00Z", "messages": [{"id": "m1", "role": "user", "parts": []}],
        })
        self.assertEqual(status, 200)
        # A cleared title is stored as NULL, the same "no title" state a chat with no title
        # has. Asserting on `description IS NULL` rather than on '' avoids depending on how
        # psql's -tA renders an empty field.
        self.assertEqual(psql("SELECT description IS NULL FROM chats WHERE id='c2';"), ["t"],
                         "an explicit empty string must clear the title")
        # Clearing the title must not touch the urlId, which was NOT sent as "".
        self.assertEqual(psql("SELECT url_id FROM chats WHERE id='c2';"), ["2-c2-0"])


class ProjectSlugOwnership(Base):
    def test_two_owners_may_record_the_same_slug(self):
        a = self.call("PUT", "/projects/mon-site", {"id": "mon-site", "name": "A", "url": "/container/mon-site/index.html"})
        b = self.call("PUT", "/projects/mon-site", {"id": "mon-site", "name": "B", "url": "/container/mon-site/index.html"},
                      owner=self.other)
        self.assertEqual(a[0], 200, "the first owner records the slug")
        self.assertEqual(b[0], 200, "a second owner must not be refused the same slug")
        rows = psql("SELECT count(*) FROM projects WHERE slug='mon-site';")
        self.assertEqual(rows, ["2"], "each owner keeps their own row")

    def test_republishing_my_own_slug_updates_my_row_only(self):
        self.call("PUT", "/projects/s", {"id": "s", "name": "v1", "url": "/container/s/index.html"})
        self.call("PUT", "/projects/s", {"id": "s", "name": "v2", "url": "/container/s/index.html"})
        self.assertEqual(psql("SELECT count(*) FROM projects WHERE slug='s';"), ["1"])
        self.assertEqual(psql("SELECT name FROM projects WHERE slug='s';"), ["v2"])

    def test_listing_only_returns_my_own_projects(self):
        self.call("PUT", "/projects/mine", {"id": "mine", "name": "Mine", "url": "/container/mine/index.html"})
        self.call("PUT", "/projects/theirs", {"id": "theirs", "name": "Theirs", "url": "/container/theirs/index.html"},
                  owner=self.other)
        status, body = self.call("GET", "/projects")
        self.assertEqual(status, 200)
        names = [p.get("name") for p in body.get("projects", [])]
        self.assertIn("Mine", names)
        self.assertNotIn("Theirs", names, "another account's project must not appear")


if __name__ == "__main__":
    unittest.main(verbosity=2)
