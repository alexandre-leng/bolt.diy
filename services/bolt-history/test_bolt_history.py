"""Tests for bolt-history. Run with: python3 -m unittest test_bolt_history"""

import gzip
import importlib
import json
import os
import subprocess
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

# Tests run against a real PostgreSQL instance, in their own database, so a test run can
# never touch the conversations the app actually serves.
TEST_DB = os.environ.get("BOLT_HISTORY_TEST_DB", "bolt_history_test")
os.environ["BOLT_HISTORY_PG_DB"] = TEST_DB

# Refuses to start if the redirect above ever stops being effective: the suite DELETEs
# chats/projects/users, and a run against the production database would erase the user's
# real conversations without a word. See test_db_guard.py.
from test_db_guard import require_test_database

require_test_database()

bh = importlib.import_module("bolt_history")


def _psql(sql, db=TEST_DB, fetch=True):
    env = dict(os.environ, PGPASSWORD=bh.PG_PASSWORD)
    args = [
        "psql", "-h", bh.PG_HOST, "-p", str(bh.PG_PORT), "-U", bh.PG_USER, "-d", db,
        "-v", "ON_ERROR_STOP=1", "-tAc", sql,
    ]
    result = subprocess.run(args, capture_output=True, text=True, env=env)

    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())

    return [line for line in result.stdout.split("\n") if line != ""]


def _ensure_test_database():
    """Create the test database if it is missing (createdb is idempotent enough here)."""
    env = dict(os.environ, PGPASSWORD=bh.PG_PASSWORD)

    exists = subprocess.run(
        ["psql", "-h", bh.PG_HOST, "-p", str(bh.PG_PORT), "-U", bh.PG_USER, "-d", "postgres",
         "-tAc", "SELECT 1 FROM pg_database WHERE datname='%s'" % TEST_DB],
        capture_output=True, text=True, env=env,
    )

    if exists.stdout.strip() == "1":
        return

    subprocess.run(
        ["createdb", "-h", bh.PG_HOST, "-p", str(bh.PG_PORT), "-U", bh.PG_USER, TEST_DB],
        capture_output=True, text=True, env=env, check=True,
    )


def chat(chat_id, description="Test", messages=None, timestamp="2026-10-16T10:00:00Z"):
    return {
        "id": chat_id,
        "urlId": chat_id + "-slug",
        "description": description,
        "timestamp": timestamp,
        "metadata": {"gitUrl": "https://example.invalid/repo.git"},
        "messages": messages if messages is not None else [{"id": "m1", "role": "user", "parts": []}],
    }


class HistoryTestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _ensure_test_database()
        bh.init_schema()

        # Every chat needs an owner, so the suite needs a real user row to point at.
        _psql("DELETE FROM chats")
        _psql("DELETE FROM users WHERE email = 'suite@lengereau.fr'")
        cls.user_id = _psql(
            "INSERT INTO users (email, password_hash) VALUES ('suite@lengereau.fr', 'x') RETURNING id"
        )[0]
        _psql("DELETE FROM users WHERE email = 'other-suite@lengereau.fr'")
        cls.other_user_id = _psql(
            "INSERT INTO users (email, password_hash) VALUES ('other-suite@lengereau.fr', 'x') RETURNING id"
        )[0]
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), bh.Handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        _psql("DELETE FROM chats")
        _psql("DELETE FROM projects")
        # Guarded so the suite can also run (and fail on assertions) against a build that
        # predates the tombstone table.
        _psql("DO $$ BEGIN IF to_regclass('chat_tombstones') IS NOT NULL "
              "THEN DELETE FROM chat_tombstones; END IF; END $$")

    # A real user id, created once for the suite. Production sets this header from the verified
    # session (nginx auth_request -> X-Bolt-User-Id); without it the service must store nothing
    # and list nothing, which is what test_anonymity covers.
    OTHER_USER = "00000000-0000-4000-8000-0000000000ff"

    def request(self, method, path, body=None, owner=None):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Content-Type": "application/json"}

        if owner is not False:
            headers["X-Bolt-User-Id"] = owner or self.user_id
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        conn.request(method, path, body=payload, headers=headers)
        response = conn.getresponse()
        raw = response.read()
        conn.close()

        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            parsed = None

        return response.status, parsed


class TestHealth(HistoryTestBase):
    def test_health_reports_ok_and_a_database_path(self):
        status, body = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["chats"], 0)
        self.assertEqual(body["backend"], "postgresql")
        self.assertEqual(body["database"], TEST_DB)


class TestCreateAndRead(HistoryTestBase):
    def test_put_then_get_round_trips_the_messages(self):
        status, body = self.request("PUT", "/history/abc-1", chat("abc-1", description="Ma conversation"))
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])

        status, body = self.request("GET", "/history/abc-1")
        self.assertEqual(status, 200)
        self.assertEqual(body["chat"]["description"], "Ma conversation")
        self.assertEqual(len(body["chat"]["messages"]), 1)
        self.assertEqual(body["chat"]["metadata"]["gitUrl"], "https://example.invalid/repo.git")

    def test_put_is_idempotent_and_replaces_rather_than_duplicates(self):
        self.request("PUT", "/history/abc-1", chat("abc-1", description="v1"))
        self.request("PUT", "/history/abc-1", chat("abc-1", description="v2"))

        status, body = self.request("GET", "/history")
        self.assertEqual(len(body["chats"]), 1)

        status, body = self.request("GET", "/history/abc-1")
        self.assertEqual(body["chat"]["description"], "v2")

    def test_a_write_without_a_url_id_does_not_erase_the_stored_one(self):
        """
        A chat is re-sent on every turn, and not every write carries a urlId. The update
        used `url_id = EXCLUDED.url_id`, so such a write replaced the stored link with NULL
        and the conversation became unreachable by its URL — the address bar id no longer
        resolved. An omitted field must leave a known value alone.
        """
        self.request("PUT", "/history/abc-1", chat("abc-1", description="v1"))

        # Same chat, re-sent without the urlId (and with newer content).
        payload = chat("abc-1", description="v2")
        del payload["urlId"]
        status, _ = self.request("PUT", "/history/abc-1", payload)
        self.assertEqual(status, 200)

        status, body = self.request("GET", "/history/abc-1")
        self.assertEqual(body["chat"]["urlId"], "abc-1-slug", "the stored urlId was erased")
        self.assertEqual(body["chat"]["description"], "v2", "the rest of the write was dropped")

    def test_a_write_without_a_url_id_can_still_be_found_by_it(self):
        """The same hazard seen through the lookup: reading by urlId must still work."""
        self.request("PUT", "/history/abc-1", chat("abc-1"))

        payload = chat("abc-1", description="sans lien")
        del payload["urlId"]
        self.request("PUT", "/history/abc-1", payload)

        status, body = self.request("GET", "/history/abc-1-slug")
        self.assertEqual(status, 200, "the chat is no longer reachable by its urlId")
        self.assertEqual(body["chat"]["id"], "abc-1")

    def test_an_explicitly_emptied_url_id_clears_the_link(self):
        """
        PATCH semantics, as decided: a field that is ABSENT keeps its stored value, while an
        explicit '' clears it. This used to be impossible to express — an absent field and an
        empty one both arrived at SQL as '' — so '' was treated as "unchanged" out of safety.
        The write now branches on whether the key was present, so '' is honoured as a clear.
        """
        self.request("PUT", "/history/abc-1", chat("abc-1"))

        payload = chat("abc-1", description="lien vide")
        payload["urlId"] = ""
        self.request("PUT", "/history/abc-1", payload)

        status, body = self.request("GET", "/history/abc-1")
        self.assertIsNone(body["chat"]["urlId"], "an explicit '' must clear the link")

    def test_an_omitted_url_id_keeps_the_stored_link(self):
        """The complement: not sending the key at all must not touch what is stored."""
        self.request("PUT", "/history/abc-2", chat("abc-2"))

        payload = chat("abc-2", description="sans urlId")
        payload.pop("urlId")
        self.request("PUT", "/history/abc-2", payload)

        status, body = self.request("GET", "/history/abc-2")
        self.assertEqual(body["chat"]["urlId"], "abc-2-slug")

    def test_list_omits_messages_to_keep_the_payload_small(self):
        self.request("PUT", "/history/abc-1", chat("abc-1"))

        status, body = self.request("GET", "/history")
        self.assertEqual(status, 200)
        self.assertNotIn("messages", body["chats"][0])

    def test_list_is_newest_first(self):
        self.request("PUT", "/history/old", chat("old", timestamp="2026-01-01T00:00:00Z"))
        self.request("PUT", "/history/new", chat("new", timestamp="2026-12-31T00:00:00Z"))

        status, body = self.request("GET", "/history")
        self.assertEqual([c["id"] for c in body["chats"]], ["new", "old"])

    def test_get_missing_chat_is_404(self):
        status, _ = self.request("GET", "/history/does-not-exist")
        self.assertEqual(status, 404)


class TestValidation(HistoryTestBase):
    def test_rejects_an_id_that_would_escape_the_url(self):
        # Path traversal and separators must never reach the database key.
        for bad in ("..%2Fetc", "a%2Fb", "a%20b"):
            status, _ = self.request("PUT", "/history/" + bad, chat("x"))
            self.assertIn(status, (400, 404), "id %r was accepted" % bad)

    def test_rejects_a_body_whose_id_disagrees_with_the_url(self):
        status, _ = self.request("PUT", "/history/abc-1", chat("other-id"))
        self.assertEqual(status, 400)

    def test_rejects_messages_that_are_not_a_list(self):
        payload = chat("abc-1")
        payload["messages"] = "not-a-list"
        status, _ = self.request("PUT", "/history/abc-1", payload)
        self.assertEqual(status, 400)

    def test_rejects_a_missing_timestamp(self):
        payload = chat("abc-1")
        del payload["timestamp"]
        status, _ = self.request("PUT", "/history/abc-1", payload)
        self.assertEqual(status, 400)

    def test_rejects_a_non_object_metadata(self):
        payload = chat("abc-1")
        payload["metadata"] = "nope"
        status, _ = self.request("PUT", "/history/abc-1", payload)
        self.assertEqual(status, 400)

    def test_rejects_malformed_json(self):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("PUT", "/history/abc-1", body=b"{not json", headers={"Content-Type": "application/json"})
        response = conn.getresponse()
        response.read()
        conn.close()
        self.assertEqual(response.status, 400)

    def test_rejects_an_oversized_body(self):
        # The server refuses on Content-Length before reading, then closes the connection —
        # so the client may get a broken pipe while still writing. That IS the rejection:
        # assert on the response when we get one, and accept the closed connection otherwise.
        payload = chat("big-1")
        payload["messages"] = [{"id": "m", "role": "user", "parts": [], "pad": "x" * (11 * 1024 * 1024)}]

        try:
            status, _ = self.request("PUT", "/history/big-1", payload)
        except BrokenPipeError:
            status = 400

        self.assertEqual(status, 400)

    def put_gzip(self, path, body_bytes, encoding="gzip"):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("PUT", path, body=body_bytes, headers={
            "Content-Type": "application/json",
            "Content-Encoding": encoding,
            "X-Bolt-User-Id": self.user_id,
        })
        response = conn.getresponse()
        raw = response.read()
        conn.close()

        return response.status, json.loads(raw.decode("utf-8") or "null")

    def test_accepts_a_gzipped_save(self):
        # A long Agent conversation is ~1 MB of JSON; the app now sends it gzipped (~10x
        # smaller). The stored chat must be exactly what an uncompressed save stores.
        payload = chat("gz-1")
        payload["messages"] = [{"id": "m", "role": "user", "parts": [{"type": "text", "text": "é" * 50_000}]}]

        status, _ = self.put_gzip("/history/gz-1", gzip.compress(json.dumps(payload).encode("utf-8")))
        self.assertEqual(status, 200)

        status, body = self.request("GET", "/history/gz-1")
        self.assertEqual(status, 200)
        self.assertEqual(body["chat"]["messages"][0]["parts"][0]["text"], "é" * 50_000)

    def test_refuses_a_gzip_bomb(self):
        # 41 MB of zeros compress to ~40 KB: the decompressed cap must stop it.
        bomb = gzip.compress(b"[" + b"0," * (21 * 1024 * 1024) + b"0]")
        self.assertLess(len(bomb), 1024 * 1024)

        status, body = self.put_gzip("/history/gz-bomb", bomb)
        self.assertEqual(status, 400)
        self.assertIn("too large", body["error"])

    def test_refuses_a_corrupt_gzip_body_and_an_unknown_encoding(self):
        status, _ = self.put_gzip("/history/gz-bad", b"not gzip at all")
        self.assertEqual(status, 400)

        status, _ = self.put_gzip("/history/gz-br", json.dumps(chat("gz-br")).encode(), encoding="br")
        self.assertEqual(status, 400)

    def test_a_chat_can_be_read_back_by_its_url_id(self):
        # Regression: the browser puts a chat's urlId in the address bar
        # (`/chat/2-1792165586520-0`) while the server keys rows on a short id (`4`). Reading
        # by id alone answered 404 for a conversation that existed, so reloading a
        # conversation from its own URL looked like an empty page.
        payload = chat("urlread-1")
        payload["urlId"] = "2-1792165586520-0"

        status, _ = self.request("PUT", "/history/urlread-1", payload)
        self.assertEqual(status, 200)

        # Read back by the urlId, the way the client actually asks for it.
        status, body = self.request("GET", "/history/2-1792165586520-0")
        self.assertEqual(status, 200)
        self.assertEqual(body["chat"]["id"], "urlread-1")
        self.assertEqual(body["chat"]["urlId"], "2-1792165586520-0")

        # The id must keep working too: both identifiers point at the same conversation.
        status, body = self.request("GET", "/history/urlread-1")
        self.assertEqual(status, 200)
        self.assertEqual(body["chat"]["urlId"], "2-1792165586520-0")

    def test_a_title_with_line_breaks_is_stored_instead_of_failing(self):
        # A raw newline in a value ended psql's \set line early: PUT answered 500.
        status, _ = self.request(
            "PUT", "/history/nl-1", chat("nl-1", description="Titre sur\ndeux lignes")
        )
        self.assertEqual(status, 200)

        status, body = self.request("GET", "/history/nl-1")
        self.assertEqual(status, 200)
        self.assertEqual(body["chat"]["description"], "Titre sur deux lignes")

    def test_a_chat_without_metadata_stores_a_real_null(self):
        # Regression: a null metadata was sent as the string 'NULL', which jsonb rejects.
        payload = chat("no-meta")
        payload["metadata"] = None
        payload["urlId"] = None
        payload["description"] = None

        status, _ = self.request("PUT", "/history/no-meta", payload)
        self.assertEqual(status, 200)

        rows = _psql("SELECT coalesce(metadata::text,'<null>') FROM chats WHERE id = 'no-meta'")
        self.assertEqual(rows, ["<null>"])

        status, body = self.request("GET", "/history/no-meta")
        self.assertEqual(status, 200)
        self.assertIsNone(body["chat"]["metadata"])

    def test_validate_chat_accepts_a_minimal_valid_chat(self):
        parsed, error = bh.validate_chat(chat("ok-1"))
        self.assertIsNone(error)
        self.assertIsNotNone(parsed)


class TestDelete(HistoryTestBase):
    def test_delete_removes_the_chat(self):
        self.request("PUT", "/history/abc-1", chat("abc-1"))

        status, body = self.request("DELETE", "/history/abc-1")
        self.assertEqual(status, 200)
        self.assertEqual(body["removed"], 1)

        status, _ = self.request("GET", "/history/abc-1")
        self.assertEqual(status, 404)

    def test_delete_of_a_missing_chat_reports_zero_removed(self):
        status, body = self.request("DELETE", "/history/ghost")
        self.assertEqual(status, 200)
        self.assertEqual(body["removed"], 0)


class TestProjects(HistoryTestBase):
    """Publishing records the site, so its URL survives a browser wipe on any device."""

    def test_put_then_list_a_published_project(self):
        status, body = self.request(
            "PUT", "/projects/mon-site", {"name": "Mon site", "url": "/container/mon-site/"}
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])

        status, body = self.request("GET", "/projects")
        self.assertEqual(status, 200)
        self.assertEqual(len(body["projects"]), 1)
        self.assertEqual(body["projects"][0]["slug"], "mon-site")
        self.assertEqual(body["projects"][0]["url"], "/container/mon-site/")

    def test_republishing_updates_instead_of_duplicating(self):
        self.request("PUT", "/projects/p1", {"name": "v1", "url": "/container/p1/"})
        self.request("PUT", "/projects/p1", {"name": "v2", "url": "/container/p1/"})

        status, body = self.request("GET", "/projects")
        self.assertEqual(len(body["projects"]), 1)
        self.assertEqual(body["projects"][0]["name"], "v2")

    def test_a_project_can_be_linked_to_its_chat(self):
        self.request("PUT", "/projects/p1", {"name": "p", "url": "/container/p1/", "chatId": "chat-9"})

        status, body = self.request("GET", "/projects")
        self.assertEqual(body["projects"][0]["chatId"], "chat-9")

    def test_a_project_without_a_chat_reports_null(self):
        self.request("PUT", "/projects/p1", {"name": "p", "url": "/container/p1/"})

        status, body = self.request("GET", "/projects")
        self.assertIsNone(body["projects"][0]["chatId"])

    def test_rejects_a_project_without_a_url(self):
        status, _ = self.request("PUT", "/projects/p1", {"name": "p"})
        self.assertEqual(status, 400)

    def test_rejects_an_invalid_slug(self):
        status, _ = self.request("PUT", "/projects/Bad%20Slug", {"url": "/container/x/"})
        self.assertIn(status, (400, 404))

    def test_projects_are_newest_first(self):
        self.request("PUT", "/projects/old", {"name": "old", "url": "/container/old/"})
        self.request("PUT", "/projects/new", {"name": "new", "url": "/container/new/"})
        # published_at defaults to now(); both land in the same second, so assert membership
        # and that the newest insert is present rather than relying on sub-second ordering.
        status, body = self.request("GET", "/projects")
        self.assertEqual({p["slug"] for p in body["projects"]}, {"old", "new"})


class TestOwnership(HistoryTestBase):
    """A conversation belongs to one account and must be invisible to every other."""

    def test_an_unauthenticated_request_cannot_write(self):
        # No owner header: the row must not be stored under a null owner.
        status, _ = self.request("PUT", "/history/anon-1", chat("anon-1"), owner=False)
        self.assertEqual(status, 401)
        self.assertEqual(_psql("SELECT count(*)::text FROM chats"), ["0"])

    def test_an_unauthenticated_request_lists_nothing(self):
        self.request("PUT", "/history/mine-1", chat("mine-1"))

        status, body = self.request("GET", "/history", owner=False)
        # A missing owner is rejected as unauthenticated (it used to reach psql as ''::uuid
        # and surface as a 500), and never lists another account's chats.
        self.assertEqual(status, 401)
        self.assertNotIn("mine-1", json.dumps(body))

    def test_an_unauthenticated_request_cannot_read_a_chat(self):
        self.request("PUT", "/history/anon-2", chat("anon-2"))

        status, _ = self.request("GET", "/history/anon-2", owner=False)
        self.assertEqual(status, 401)

    def test_an_unauthenticated_request_cannot_delete(self):
        self.request("PUT", "/history/anon-3", chat("anon-3"))

        status, body = self.request("DELETE", "/history/anon-3", owner=False)
        self.assertEqual(status, 401)
        self.assertEqual(_psql("SELECT count(*)::text FROM chats"), ["1"])

    def test_another_user_cannot_read_the_chat(self):
        self.request("PUT", "/history/private-1", chat("private-1", description="Privée"))

        status, _ = self.request("GET", "/history/private-1", owner=self.other_user_id)
        self.assertEqual(status, 404)

    def test_another_user_cannot_list_the_chat(self):
        self.request("PUT", "/history/private-2", chat("private-2", description="Privée"))

        status, body = self.request("GET", "/history", owner=self.other_user_id)
        self.assertEqual(status, 200)
        self.assertEqual(body["chats"], [])

    def test_another_user_cannot_delete_the_chat(self):
        self.request("PUT", "/history/private-3", chat("private-3"))

        status, body = self.request("DELETE", "/history/private-3", owner=self.other_user_id)
        self.assertEqual(status, 200)
        self.assertEqual(body["removed"], 0)
        self.assertEqual(_psql("SELECT count(*)::text FROM chats WHERE id = 'private-3'"), ["1"])

    def test_the_owner_still_sees_their_own_chat(self):
        self.request("PUT", "/history/mine-2", chat("mine-2", description="À moi"))

        status, body = self.request("GET", "/history/mine-2")
        self.assertEqual(status, 200)
        self.assertEqual(body["chat"]["description"], "À moi")

    def test_another_user_cannot_overwrite_a_chat_with_the_same_id(self):
        # Chat ids are small per-browser counters ("1", "2"...), so two accounts DO reuse them.
        self.request("PUT", "/history/1", chat("1", description="Alex"))

        status, _ = self.request("PUT", "/history/1", chat("1", description="Intrus"), owner=self.other_user_id)

        self.assertEqual(status, 409)
        rows = _psql("SELECT description || '|' || user_id FROM chats WHERE id = '1'")
        self.assertEqual(rows, ["Alex|%s" % self.user_id])

    def test_the_owner_can_still_update_their_chat(self):
        self.request("PUT", "/history/2", chat("2", description="v1"))

        status, _ = self.request("PUT", "/history/2", chat("2", description="v2"))

        self.assertEqual(status, 200)
        self.assertEqual(_psql("SELECT description FROM chats WHERE id = '2'"), ["v2"])

    def test_each_chat_records_its_owner(self):
        self.request("PUT", "/history/mine-3", chat("mine-3"))

        rows = _psql("SELECT user_id FROM chats WHERE id = 'mine-3'")
        self.assertEqual(rows, [self.user_id])


class TestProjectOwnership(HistoryTestBase):
    """H1/H4: a published project belongs to the account that published it."""

    def test_another_user_does_not_list_my_projects(self):
        # GET /projects returned every account's sites to any signed-in user.
        self.request("PUT", "/projects/mon-site", {"name": "A", "url": "/container/mon-site/"})

        status, body = self.request("GET", "/projects", owner=self.other_user_id)
        self.assertEqual(status, 200)
        self.assertEqual(body["projects"], [])

        status, body = self.request("GET", "/projects")
        self.assertEqual([p["slug"] for p in body["projects"]], ["mon-site"])

    def test_listing_projects_requires_an_identity(self):
        self.request("PUT", "/projects/mon-site", {"name": "A", "url": "/container/mon-site/"})

        status, body = self.request("GET", "/projects", owner=False)
        self.assertEqual(status, 401)
        self.assertNotIn("mon-site", json.dumps(body))

    def test_another_user_may_record_the_same_slug_separately(self):
        """A slug belongs to a user, not to the installation.

        This asserted 409 before: `slug` was the sole PRIMARY KEY, so a second account whose
        title slugified the same was refused and its legitimate publish silently never
        appeared in its history. Each account now keeps its own row for the same slug, and
        neither can take over the other's.
        """
        self.request("PUT", "/projects/mon-site", {"name": "A", "url": "/container/mon-site/"})

        status, _ = self.request(
            "PUT", "/projects/mon-site", {"name": "B", "url": "/container/mon-site/"},
            owner=self.other_user_id,
        )
        self.assertEqual(status, 200, "a second account must not be refused the same slug")

        rows = _psql(
            "SELECT name || '|' || user_id FROM projects WHERE slug = 'mon-site' ORDER BY name"
        )
        self.assertEqual(len(rows), 2, "each account keeps its own row")
        self.assertIn("A|%s" % self.user_id, rows)
        self.assertIn("B|%s" % self.other_user_id, rows)

    def test_recording_a_project_requires_an_identity(self):
        status, _ = self.request("PUT", "/projects/anon", {"name": "x", "url": "/container/anon/"}, owner=False)
        self.assertEqual(status, 401)
        self.assertEqual(_psql("SELECT count(*)::text FROM projects"), ["0"])

    def test_rejects_a_url_that_is_not_a_container_path(self):
        for bad in ("javascript:alert(1)", "https://phishing.example/", "//evil.example/x",
                    "data:text/html,x", "/container/../admin", "/container/x/../../admin", "/dashboard"):
            status, _ = self.request("PUT", "/projects/p1", {"name": "p", "url": bad})
            self.assertEqual(status, 400, "url %r was accepted" % bad)
        self.assertEqual(_psql("SELECT count(*)::text FROM projects"), ["0"])


class TestTombstones(HistoryTestBase):
    """H12: a deletion is recorded so other devices stop pushing the chat back."""

    def test_delete_is_listed_as_a_tombstone(self):
        self.request("PUT", "/history/abc-1", chat("abc-1"))
        self.request("DELETE", "/history/abc-1")

        status, body = self.request("GET", "/history")
        self.assertEqual(status, 200)
        self.assertEqual(body["chats"], [])
        self.assertEqual(len(body["deleted"]), 1)
        self.assertEqual(body["deleted"][0]["id"], "abc-1")
        self.assertEqual(body["deleted"][0]["urlId"], "abc-1-slug")
        self.assertRegex(body["deleted"][0]["deletedAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_delete_by_url_id_records_the_real_id(self):
        self.request("PUT", "/history/abc-1", chat("abc-1"))
        self.request("DELETE", "/history/abc-1-slug")

        status, body = self.request("GET", "/history")
        self.assertEqual([d["id"] for d in body["deleted"]], ["abc-1"])

    def test_a_deleted_chat_cannot_be_pushed_back(self):
        # The resurrection path: another device still holds the chat and re-sends it.
        self.request("PUT", "/history/abc-1", chat("abc-1"))
        self.request("DELETE", "/history/abc-1")

        status, body = self.request("PUT", "/history/abc-1", chat("abc-1", description="copie"))
        self.assertEqual(status, 410)
        self.assertEqual(body, {"ok": False, "error": "deleted"})
        self.assertEqual(_psql("SELECT count(*)::text FROM chats WHERE id = 'abc-1'"), ["0"])

    def test_a_list_without_deletions_reports_an_empty_list(self):
        self.request("PUT", "/history/abc-1", chat("abc-1"))
        status, body = self.request("GET", "/history")
        self.assertEqual(body["deleted"], [])

    def test_tombstones_are_per_owner(self):
        # Ids are per-browser counters: another account's deletion of "1" must not block
        # (nor be listed to) this account.
        self.request("PUT", "/history/1", chat("1"), owner=self.other_user_id)
        self.request("DELETE", "/history/1", owner=self.other_user_id)

        status, body = self.request("GET", "/history")
        self.assertEqual(body["deleted"], [])
        status, _ = self.request("PUT", "/history/1", chat("1"))
        self.assertEqual(status, 200)

    def test_a_delete_of_nothing_leaves_no_tombstone(self):
        self.request("DELETE", "/history/ghost")
        status, body = self.request("GET", "/history")
        self.assertEqual(body["deleted"], [])

    def test_tombstones_older_than_90_days_are_not_listed(self):
        self.request("PUT", "/history/old-1", chat("old-1"))
        self.request("DELETE", "/history/old-1")
        _psql("UPDATE chat_tombstones SET deleted_at = now() - interval '91 days'")

        status, body = self.request("GET", "/history")
        self.assertEqual(body["deleted"], [])

    def test_tombstones_are_removed_with_the_account(self):
        uid = _psql("INSERT INTO users (email, password_hash) VALUES ('gone-suite@lengereau.fr', 'x') RETURNING id")[0]
        try:
            self.request("PUT", "/history/bye-1", chat("bye-1"), owner=uid)
            self.request("DELETE", "/history/bye-1", owner=uid)
            self.assertEqual(_psql("SELECT count(*)::text FROM chat_tombstones WHERE user_id = '%s'" % uid), ["1"])
        finally:
            _psql("DELETE FROM users WHERE id = '%s'" % uid)
        self.assertEqual(_psql("SELECT count(*)::text FROM chat_tombstones WHERE user_id = '%s'" % uid), ["0"])


class TestPersistence(HistoryTestBase):
    def test_data_survives_a_fresh_connection(self):
        # The point of the service: history outlives the browser, so it must outlive a request.
        self.request("PUT", "/history/abc-1", chat("abc-1", description="persistante"))

        rows = _psql("SELECT description FROM chats WHERE id = 'abc-1'")

        self.assertEqual(rows, ["persistante"])

    def test_a_quote_in_the_id_cannot_break_out_of_its_sql_literal(self):
        # Values travel as psql variables, never concatenated into SQL text.
        rows = _psql("SELECT count(*)::text FROM chats")
        self.assertEqual(rows, ["0"])

        status, _ = self.request("PUT", "/history/injection", chat("injection", description="l'apostrophe"))
        self.assertEqual(status, 200)

        rows = _psql("SELECT description FROM chats WHERE id = 'injection'")
        self.assertEqual(rows, ["l'apostrophe"])

    def test_delete_removes_the_row_from_postgres(self):
        self.request("PUT", "/history/abc-1", chat("abc-1"))
        self.request("DELETE", "/history/abc-1")
        self.assertEqual(_psql("SELECT count(*)::text FROM chats"), ["0"])


if __name__ == "__main__":
    unittest.main()


class TestHostileTextInTitles(HistoryTestBase):
    """A title is free text: it must never break the history list of the whole account.

    One conversation whose title contained the ASCII unit separator used to make GET /api/history
    answer 502 (row_to_chat raised while building the list), so every device lost its history.
    """

    def test_a_title_with_control_characters_lists_cleanly(self):
        hostile = "piège\x1f\x1e ligne\nsuite\ttab\\fin"

        status_in, body = self.request("PUT", "/history/hostile-1", {
            "id": "hostile-1", "urlId": "hostile-1-url", "description": hostile,
            "timestamp": "2026-10-18T10:00:00Z", "messages": [{"id": "m1", "role": "user", "content": "hi"}],
        })
        self.assertEqual(status_in, 200, body)

        status, payload = self.request("GET", "/history")
        self.assertEqual(status, 200, payload)
        listed = [c for c in payload["chats"] if c["id"] == "hostile-1"]
        self.assertEqual(len(listed), 1)
        # A newline is folded to a space (it cannot travel in the psql script); everything else,
        # including the control characters that used to break the list, survives verbatim except
        # the record separator \x1e, which the client shows as a space.
        self.assertEqual(listed[0]["description"], "piège\x1f  ligne suite\ttab\\fin")

    def test_another_conversation_still_lists_next_to_a_hostile_title(self):
        self.request("PUT", "/history/hostile-2", {
            "id": "hostile-2", "urlId": "hostile-2-url", "description": "titre\x1fpiège",
            "timestamp": "2026-10-18T10:00:00Z", "messages": [{"id": "m1", "role": "user", "content": "hi"}],
        })
        self.request("PUT", "/history/clean-2", {
            "id": "clean-2", "urlId": "clean-2-url", "description": "Titre normal",
            "timestamp": "2026-10-18T11:00:00Z", "messages": [{"id": "m1", "role": "user", "content": "hi"}],
        })

        status, payload = self.request("GET", "/history")
        self.assertEqual(status, 200, payload)
        ids = [c["id"] for c in payload["chats"]]
        self.assertIn("clean-2", ids)
        self.assertIn("hostile-2", ids)


class TestEscapeRoundTrip(HistoryTestBase):
    """What a user writes in a title must come back exactly, through the real database.

    The title travels through psql as one delimited line, so it is escaped on the way out and
    unescaped on the way in. The dangerous inputs are the ones that LOOK like an escape already:
    a title that contains the two characters backslash + x must not be turned into the unit
    separator, and a real unit separator must not be turned into the letter x.
    """

    def put_and_read_back(self, chat_id, description):
        body = {"id": chat_id, "urlId": chat_id + "-url", "description": description,
                "timestamp": "2026-10-18T10:00:00Z", "messages": [{"id": "m1", "role": "user", "content": "hi"}]}
        self.assertEqual(self.request("PUT", "/history/" + chat_id, body)[0], 200)

        status, listing = self.request("GET", "/history")
        self.assertEqual(status, 200, listing)
        listed = [c for c in listing["chats"] if c["id"] == chat_id]
        self.assertEqual(len(listed), 1)

        status, single = self.request("GET", "/history/" + chat_id)
        self.assertEqual(status, 200, single)

        return listed[0]["description"], single["chat"]["description"]

    def test_a_title_that_looks_like_an_escape_is_not_decoded(self):
        for name, title in (
            ("written-x", "version\\x1f finale"),
            ("written-e", "etape\\e suivante"),
            ("written-n", "dossier C:\\new\\notes"),
            ("trailing-backslash", "fin\\"),
            ("double-backslash", "a\\\\b"),
        ):
            with self.subTest(title=title):
                from_list, from_single = self.put_and_read_back("esc-" + name, title)
                self.assertEqual(from_list, title)
                self.assertEqual(from_single, title)

    def test_the_list_and_the_single_read_agree_on_a_hostile_title(self):
        title = "mélange\\x \x1f et \\\\ fin"

        from_list, from_single = self.put_and_read_back("esc-agree", title)

        self.assertEqual(from_list, from_single)

    def test_a_hostile_title_does_not_corrupt_the_message_count(self):
        """The reader splits a row on separators; a stray one in a title must not shift columns."""
        body = {"id": "esc-count", "urlId": "esc-count-url", "description": "a\x1fb\x1ec\\d",
                "timestamp": "2026-10-18T10:00:00Z",
                "messages": [{"id": "m%d" % n, "role": "user", "content": "x"} for n in range(3)]}
        self.assertEqual(self.request("PUT", "/history/esc-count", body)[0], 200)

        status, single = self.request("GET", "/history/esc-count")

        self.assertEqual(status, 200, single)
        self.assertEqual(len(single["chat"]["messages"]), 3)
        self.assertEqual(single["chat"]["urlId"], "esc-count-url")


class TestSingleChatReadWithHostileTitle(HistoryTestBase):
    """GET /api/history/<id> must survive a title holding the record separator.

    The list query escapes its text columns; the single-chat query did not, so reading such a
    conversation raised JSONDecodeError while parsing the messages column and answered 502 —
    the user could not open their own conversation at all.
    """

    def test_a_conversation_with_a_control_character_in_its_title_can_be_read(self):
        hostile = {"id": "hostile-read", "urlId": "hostile-read-url", "description": "titre\x1fpiège\x1ex",
                   "timestamp": "2026-10-18T10:00:00Z", "messages": [{"id": "m1", "role": "user", "content": "hi"}]}
        self.assertEqual(self.request("PUT", "/history/hostile-read", hostile)[0], 200)

        status, body = self.request("GET", "/history/hostile-read")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["chat"]["id"], "hostile-read")
        self.assertEqual(body["chat"]["messages"][0]["content"], "hi")

        status, body = self.request("GET", "/history/hostile-read-url")
        self.assertEqual(status, 200, body)
