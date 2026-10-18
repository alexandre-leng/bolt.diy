"""Regression tests for the four defects fixed in bolt_history.py (audit round 2).

Each test here failed on the pre-fix build:

  1. TestNonDictPutBody          PUT /history/<id> with a JSON array body dropped the socket.
  2. TestPartialUpdatePreserves Test(partial update erasing title/metadata)
  3. TestProfileHostileText      GET /profile corrupted by a hostile bio.
  4. TestNoInternalsLeaked       a DB failure leaked psql stderr into the response.

Run with: BOLT_HISTORY_TEST_DB=<scratch db> /usr/bin/python3 -m unittest test_bolt_history_audit2
"""

import importlib
import json
import os
import unittest

from http.client import HTTPConnection

# Reuse the base harness (private test DB, server, owner headers) from the main suite.
import test_bolt_history as base

TEST_DB = base.TEST_DB
bh = base.bh


class TestNonDictPutBody(base.HistoryTestBase):
    """Defect 1: a non-object JSON body crashed do_PUT *outside* the try, dropping the socket."""

    def test_a_json_array_body_is_rejected_with_400_not_a_dropped_connection(self):
        # `payload.get("id")` was called before any type check, so a list raised
        # AttributeError outside the try, the connection closed with no response and the
        # client saw a dropped socket instead of a 400.
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        raw = json.dumps([{"id": "abc-1"}]).encode("utf-8")
        conn.request("PUT", "/history/abc-1", body=raw, headers={
            "Content-Type": "application/json",
            "X-Bolt-User-Id": self.user_id,
        })
        try:
            response = conn.getresponse()
            body = response.read()
        except Exception as exc:  # noqa: BLE001 - the pre-fix failure mode IS the assertion
            self.fail("PUT with an array body dropped the connection: %r" % exc)
        finally:
            conn.close()

        self.assertEqual(response.status, 400, body)

    def test_a_json_string_body_is_rejected_with_400(self):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("PUT", "/history/abc-1", body=json.dumps("just-a-string").encode(),
                     headers={"Content-Type": "application/json", "X-Bolt-User-Id": self.user_id})
        try:
            response = conn.getresponse()
            body = response.read()
        except Exception as exc:  # noqa: BLE001
            self.fail("PUT with a string body dropped the connection: %r" % exc)
        finally:
            conn.close()

        self.assertEqual(response.status, 400, body)


class TestPartialUpdatePreserves(base.HistoryTestBase):
    """Defect 2: description and metadata were overwritten unconditionally on conflict."""

    def test_a_partial_write_does_not_erase_the_stored_title_or_metadata(self):
        # First write stores a real title and metadata.
        full = base.chat("pu-1", description="Titre original")
        self.assertEqual(self.request("PUT", "/history/pu-1", full)[0], 200)

        # Re-send the same chat with the optional fields OMITTED (a partial save from a
        # device that only carries messages + timestamp). The old ON CONFLICT set
        # description = EXCLUDED.description and metadata = EXCLUDED.metadata, erasing both.
        partial = {
            "id": "pu-1",
            "timestamp": "2026-10-18T12:00:00Z",
            "messages": [{"id": "m2", "role": "user", "content": "suite"}],
        }
        self.assertEqual(self.request("PUT", "/history/pu-1", partial)[0], 200)

        status, body = self.request("GET", "/history/pu-1")
        self.assertEqual(status, 200)
        self.assertEqual(body["chat"]["description"], "Titre original",
                         "a partial write erased the stored title")
        self.assertIsNotNone(body["chat"]["metadata"],
                             "a partial write erased the stored metadata")
        self.assertEqual(body["chat"]["metadata"]["gitUrl"], "https://example.invalid/repo.git")

    def test_a_partial_list_write_keeps_the_title_in_the_listing(self):
        self.request("PUT", "/history/pu-2", base.chat("pu-2", description="Titre liste"))
        partial = {"id": "pu-2", "timestamp": "2026-10-18T12:00:00Z",
                   "messages": [{"id": "m2", "role": "user", "content": "x"}]}
        self.request("PUT", "/history/pu-2", partial)

        status, body = self.request("GET", "/history")
        listed = [c for c in body["chats"] if c["id"] == "pu-2"]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["description"], "Titre liste")


class TestProfileHostileText(base.HistoryTestBase):
    """Defect 3: GET /profile selected its columns with NO sql_escaped(), so \\x1e split the row."""

    def test_a_hostile_bio_does_not_bleed_into_the_avatar_field(self):
        # A bio holding the record separator made split_row cut the row in the middle: the
        # tail of the bio landed in the avatar field and the JSON was corrupt.
        bio = "ligne1\x1eAVATAR_FAKE\x1fligne2"
        status, _ = self.request("PUT", "/profile",
                                 {"username": "alex", "bio": bio, "avatar": "real-avatar.png"})
        self.assertEqual(status, 200)

        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("GET", "/profile", headers={"X-Bolt-User-Id": self.user_id})
        response = conn.getresponse()
        raw = response.read()
        conn.close()

        self.assertEqual(response.status, 200, raw)
        parsed = json.loads(raw.decode("utf-8"))
        profile = parsed["profile"]
        self.assertEqual(profile["username"], "alex")
        # The avatar must be exactly what was stored, untouched by the bio's separator.
        self.assertEqual(profile["avatar"], "real-avatar.png",
                         "the bio's separator bled into the avatar field")
        self.assertNotIn("AVATAR_FAKE", profile["avatar"])
        # The bio keeps its own control characters (the client renders \\x1e as a space).
        self.assertIn("ligne1", profile["bio"])
        self.assertIn("ligne2", profile["bio"])

    def test_a_hostile_username_does_not_corrupt_the_profile_json(self):
        status, _ = self.request("PUT", "/profile",
                                 {"username": "us\x1eer", "bio": "simple", "avatar": "a.png"})
        self.assertEqual(status, 200)

        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("GET", "/profile", headers={"X-Bolt-User-Id": self.user_id})
        response = conn.getresponse()
        raw = response.read()
        conn.close()

        parsed = json.loads(raw.decode("utf-8"))
        self.assertIn("us", parsed["profile"]["username"])
        self.assertEqual(parsed["profile"]["avatar"], "a.png")


class TestNoInternalsLeaked(base.HistoryTestBase):
    """Defect 4: a DB error surfaced raw psql stderr (constraint/column names) in the body."""

    def test_a_database_failure_does_not_leak_psql_internals(self):
        # Force a real DatabaseError on the /profile GET by making the query fail: rename the
        # profile table out from under the handler, then call it (and put it back).
        base._psql("ALTER TABLE profile RENAME TO profile_hidden")
        try:
            conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
            conn.request("GET", "/profile", headers={"X-Bolt-User-Id": self.user_id})
            response = conn.getresponse()
            raw = response.read()
            conn.close()
        finally:
            base._psql("ALTER TABLE profile_hidden RENAME TO profile")

        self.assertEqual(response.status, 500, raw)
        body = json.loads(raw.decode("utf-8"))
        message = body["error"]
        # The generic message must be returned; no psql stderr, no SQL, no relation name.
        self.assertNotIn("profile", message.lower())
        self.assertNotIn("psql", message.lower())
        self.assertNotIn("ERROR", message)
        self.assertNotIn("LINE", message)
        self.assertNotIn("SELECT", message.upper())
        self.assertIn("database", message.lower())


if __name__ == "__main__":
    unittest.main()
