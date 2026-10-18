#!/usr/bin/env python3
"""Security regressions for bolt-accounts (lot 3: H5, H7, H10, H11).

Runs the real handler in-process against a PRIVATE PostgreSQL test database — never the
production service or database. Outgoing mail is captured, never sent.

    set -a; . /etc/bolt-history.env; set +a
    BOLT_ACCOUNTS_TEST_DB=bolt_history_test_fixd /usr/bin/python3 -m unittest test_accounts_security

The test database needs the accounts schema (users, sessions, auth_tokens, profiles, ...).
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import threading
import time
import unittest
import uuid
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from urllib.parse import urlencode

TEST_DB = os.environ.get("BOLT_ACCOUNTS_TEST_DB", "")
ORIGIN = "https://bolt.test.invalid"

if TEST_DB:
    # Must be set before accounts_service reads its configuration at import time.
    os.environ["BOLT_HISTORY_PG_DB"] = TEST_DB
    os.environ["BOLT_PUBLIC_ORIGIN"] = ORIGIN
    os.environ["RESEND_API_KEY"] = ""

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import accounts_service as svc  # noqa: E402
import handlers  # noqa: E402

PASSWORD = "PhraseDePasse-Tres-Longue-42!"


@unittest.skipUnless(TEST_DB and TEST_DB != "bolt_history", "set BOLT_ACCOUNTS_TEST_DB to a private test database")
class AccountsSecurityBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert svc.PG_DB == TEST_DB, "refusing to run against %r" % svc.PG_DB
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handlers.AccountsHandler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.password_hash = svc.hash_password(PASSWORD)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        svc.query("DELETE FROM users WHERE email LIKE 'sec-test-%@example.test';", fetch=False)

    def setUp(self):
        svc.query("DELETE FROM users WHERE email LIKE 'sec-test-%@example.test';", fetch=False)
        handlers._failures.clear()
        self.mails = []
        self._send_email = handlers.send_email

        def capture(to, subject, text, html_body):
            self.mails.append({"to": to, "subject": subject, "text": text})
            return True, "captured"

        handlers.send_email = capture
        self.ip = "10.%d.%d.%d" % tuple(uuid.uuid4().bytes[:3])

    def tearDown(self):
        handlers.send_email = self._send_email

    # --- helpers ---------------------------------------------------------------

    def make_user(self, label="user"):
        email = "sec-test-%s-%s@example.test" % (label, uuid.uuid4().hex[:8])
        uid = svc.query(
            "INSERT INTO users (email, password_hash, email_verified) VALUES (:'e', :'p', true) RETURNING id;",
            {"e": email, "p": self.password_hash},
        )[0][0]
        return uid, email

    def session_count(self, uid):
        return int(svc.query("SELECT count(*)::text FROM sessions WHERE user_id = :'u'::uuid;", {"u": uid})[0][0])

    def session_exists(self, raw):
        return svc.query("SELECT 1 FROM sessions WHERE token_hash = :'h';", {"h": svc.sha256(raw)}) != []

    def request(self, method, path, body=None, form=False, cookie=None, headers=None):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=30)
        sent = {"X-Real-IP": self.ip}

        if body is not None:
            if form:
                payload = urlencode(body).encode()
                sent["Content-Type"] = "application/x-www-form-urlencoded"
            else:
                payload = json.dumps(body).encode()
                sent["Content-Type"] = "application/json"
        else:
            payload = None

        if cookie:
            sent["Cookie"] = "%s=%s" % (svc.COOKIE, cookie)

        sent.update(headers or {})
        conn.request(method, path, body=payload, headers=sent)
        response = conn.getresponse()
        raw = response.read()
        set_cookie = response.getheader("Set-Cookie") or ""
        location = response.getheader("Location") or ""
        conn.close()

        try:
            data = json.loads(raw.decode() or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            data = {}

        return response.status, data, set_cookie, location


class TimingEnumerationTest(AccountsSecurityBase):
    """H5: an unknown address must cost the same as a known one (login and register)."""

    def _captured_stored_hash(self, method, path, body, form):
        seen = []
        original = handlers.verify_password

        def spy(password, stored):
            seen.append(stored)
            return original(password, stored)

        handlers.verify_password = spy
        try:
            self.request(method, path, body, form=form)
        finally:
            handlers.verify_password = original
        return seen

    def _assert_real_argon2(self, stored):
        from argon2.exceptions import VerifyMismatchError

        # A parseable hash fails with a MISMATCH after a full computation; the old zero
        # placeholder failed to parse and returned in microseconds.
        with self.assertRaises(VerifyMismatchError):
            svc.HASHER.verify(stored, "wrong-password")

    def test_api_login_with_an_unknown_address_runs_a_real_verification(self):
        seen = self._captured_stored_hash("POST", "/api/auth/login",
                                          {"email": "sec-test-nobody@example.test", "password": "x" * 14}, False)
        self.assertEqual(len(seen), 1)
        self._assert_real_argon2(seen[0])

    def test_form_login_with_an_unknown_address_uses_the_same_dummy_hash(self):
        import ui.routes  # noqa: F401  (the page route calls handlers.verify_password via `h`)
        seen = self._captured_stored_hash("POST", "/login",
                                          {"email": "sec-test-nobody@example.test", "password": "x" * 14}, True)
        self.assertEqual(len(seen), 1)
        self._assert_real_argon2(seen[0])

    def test_unknown_and_known_addresses_take_comparable_time(self):
        _, email = self.make_user("timing")

        def timed(address):
            start = time.perf_counter()
            self.request("POST", "/api/auth/login", {"email": address, "password": "Mauvais-Mot-De-Passe-1"})
            return time.perf_counter() - start

        known = statistics.median(timed(email) for _ in range(3))
        handlers._failures.clear()
        unknown = statistics.median(timed("sec-test-ghost@example.test") for _ in range(3))

        # One Argon2 verification is the cost the old code skipped for an unknown address;
        # the gap must stay well under it (the rest of the request is psql noise).
        from argon2.exceptions import VerifyMismatchError
        start = time.perf_counter()
        try:
            svc.HASHER.verify(self.password_hash, "x")
        except VerifyMismatchError:
            pass
        argon2_cost = time.perf_counter() - start
        self.assertLess(known - unknown, argon2_cost * 0.5,
                        "unknown %.4fs vs known %.4fs (argon2 %.4fs)" % (unknown, known, argon2_cost))

    def _register_existing(self, path, form):
        _, email = self.make_user("dup")
        calls = []
        original = handlers.hash_password

        def spy(password):
            calls.append(password)
            return original(password)

        handlers.hash_password = spy
        try:
            body = {"email": email, "password": PASSWORD, "passwordConfirm": PASSWORD,
                    "acceptTerms": "1", "acceptPrivacy": "1"}
            status, data, _, location = self.request("POST", path, body, form=form)
        finally:
            handlers.hash_password = original
        return email, calls, status, data, location

    def test_api_register_of_an_existing_address_does_the_same_work(self):
        email, calls, status, data, _ = self._register_existing("/api/auth/register", False)
        self.assertEqual(status, 200)
        self.assertTrue(data.get("ok"))
        self.assertEqual(len(calls), 1, "no Argon2 hash on the existing-address path")
        self.assertEqual([m["to"] for m in self.mails], [email], "no mail round-trip on the existing-address path")

    def test_form_register_of_an_existing_address_does_the_same_work(self):
        email, calls, status, _, location = self._register_existing("/register", True)
        self.assertEqual(status, 303)
        self.assertIn("/login?m=", location)
        self.assertEqual(len(calls), 1, "no Argon2 hash on the existing-address path")
        self.assertEqual([m["to"] for m in self.mails], [email])


class OriginCheckTest(AccountsSecurityBase):
    """H7: state-changing requests from another origin are refused (CSRF)."""

    def test_cross_origin_login_is_refused(self):
        _, email = self.make_user("origin")
        status, _, set_cookie, _ = self.request(
            "POST", "/api/auth/login", {"email": email, "password": PASSWORD},
            headers={"Origin": "https://evil.example"},
        )
        self.assertEqual(status, 403)
        self.assertNotIn(svc.COOKIE + "=", set_cookie)

    def test_cross_origin_state_changes_are_refused_on_every_method(self):
        uid, _ = self.make_user("origin")
        token = handlers.create_session(uid, "test", self.ip)
        evil = {"Origin": "https://evil.example"}

        for method, path, body, form in (
            ("POST", "/api/auth/change-password", {"currentPassword": PASSWORD, "password": "Autre-Phrase-Longue-77"}, False),
            ("POST", "/settings/security/logout-all", {"x": "1"}, True),
            ("PUT", "/api/auth/preferences", {"theme": "dark"}, False),
            ("PATCH", "/api/auth/profile", {"displayName": "pirate"}, False),
            ("DELETE", "/api/auth/secrets", {"name": "mcp_settings"}, False),
        ):
            status, _, _, _ = self.request(method, path, body, form=form, cookie=token, headers=evil)
            self.assertEqual(status, 403, "%s %s was accepted cross-origin" % (method, path))

        self.assertTrue(self.session_exists(token), "a cross-origin request changed state")

    def test_cross_site_fetch_without_origin_is_refused(self):
        _, email = self.make_user("origin")
        status, _, _, _ = self.request(
            "POST", "/api/auth/login", {"email": email, "password": PASSWORD},
            headers={"Sec-Fetch-Site": "cross-site"},
        )
        self.assertEqual(status, 403)

    def test_same_origin_and_non_browser_requests_still_work(self):
        _, email = self.make_user("origin")
        status, _, _, _ = self.request("POST", "/api/auth/login", {"email": email, "password": PASSWORD},
                                       headers={"Origin": ORIGIN, "Sec-Fetch-Site": "same-origin"})
        self.assertEqual(status, 200)
        status, _, _, _ = self.request("POST", "/api/auth/login", {"email": email, "password": PASSWORD})
        self.assertEqual(status, 200)


class EmailChangeTest(AccountsSecurityBase):
    """H10: changing the address revokes the other sessions and warns the old address."""

    def _change(self, path, form):
        uid, old_email = self.make_user("mail")
        current = handlers.create_session(uid, "this device", self.ip)
        other = handlers.create_session(uid, "thief device", "10.9.9.9")
        new_email = "sec-test-new-%s@example.test" % uuid.uuid4().hex[:8]
        status, data, _, location = self.request(
            "POST", path, {"email": new_email, "password": PASSWORD}, form=form, cookie=current,
        )
        return uid, old_email, new_email, current, other, status, location

    def test_api_change_email_revokes_other_sessions_and_notifies_the_old_address(self):
        uid, old_email, new_email, current, other, status, _ = self._change("/api/auth/change-email", False)
        self.assertEqual(status, 200)
        self.assertFalse(self.session_exists(other), "another session survived the address change")
        self.assertTrue(self.session_exists(current), "the session making the change was dropped")
        recipients = [m["to"] for m in self.mails]
        self.assertIn(old_email, recipients, "the previous address was not told")
        self.assertIn(new_email, recipients, "no verification mail to the new address")
        notice = next(m for m in self.mails if m["to"] == old_email)
        self.assertIn(new_email, notice["text"])

    def test_form_change_email_revokes_other_sessions_and_notifies_the_old_address(self):
        uid, old_email, new_email, current, other, status, location = self._change("/settings/account/email", True)
        self.assertEqual(status, 303)
        self.assertIn("?m=", location)
        self.assertFalse(self.session_exists(other))
        self.assertTrue(self.session_exists(current))
        self.assertIn(old_email, [m["to"] for m in self.mails])


class SessionFixationTest(AccountsSecurityBase):
    """H11: the session cookie presented at login is invalidated, a new one is issued."""

    def _login_with_planted_cookie(self, path, form):
        uid, email = self.make_user("fix")
        planted = handlers.create_session(uid, "planted", "10.6.6.6")
        status, _, set_cookie, _ = self.request(
            "POST", path, {"email": email, "password": PASSWORD, "next": "/dashboard"}, form=form, cookie=planted,
        )
        return planted, status, set_cookie

    def test_api_login_invalidates_the_presented_session(self):
        planted, status, set_cookie = self._login_with_planted_cookie("/api/auth/login", False)
        self.assertEqual(status, 200)
        self.assertIn(svc.COOKIE + "=", set_cookie)
        self.assertNotIn(planted, set_cookie)
        self.assertFalse(self.session_exists(planted), "the pre-login session is still valid")

    def test_form_login_invalidates_the_presented_session(self):
        planted, status, set_cookie = self._login_with_planted_cookie("/login", True)
        self.assertEqual(status, 303)
        self.assertIn(svc.COOKIE + "=", set_cookie)
        self.assertFalse(self.session_exists(planted), "the pre-login session is still valid")


if __name__ == "__main__":
    unittest.main()


class ProfilePatchTest(AccountsSecurityBase):
    """Two profile bugs: an incomplete PATCH erased the name, a malformed body answered 500/200."""

    def _login(self):
        uid, email = self.make_user("profile")
        status, data, cookie, _ = self.request("POST", "/api/auth/login", {"email": email, "password": PASSWORD}, form=True)
        self.assertEqual(status, 200, data)
        token = cookie.split("%s=" % svc.COOKIE)[-1].split(";")[0]
        self.request("PATCH", "/api/auth/profile", {"displayName": "Alexandre Lengereau"}, cookie=token)
        return token

    def test_an_omitted_field_keeps_its_value(self):
        token = self._login()

        status, data, _, _ = self.request("PATCH", "/api/auth/profile", {"avatarUrl": ""}, cookie=token)

        self.assertEqual(status, 200, data)
        self.assertEqual(data["profile"]["displayName"], "Alexandre Lengereau")

    def test_a_malformed_body_is_refused_and_changes_nothing(self):
        token = self._login()

        status, data, _, _ = self.request("PATCH", "/api/auth/profile", "{bad", cookie=token)

        self.assertEqual(status, 400, data)
        status, data, _, _ = self.request("GET", "/api/auth/me", cookie=token)
        self.assertEqual(status, 200, data)

    def test_a_body_that_is_not_an_object_is_refused(self):
        token = self._login()

        status, data, _, _ = self.request("PATCH", "/api/auth/profile", ["not", "an", "object"], cookie=token)

        self.assertEqual(status, 400, data)

    def test_login_with_a_non_object_body_answers_400_not_a_crash(self):
        status, data, _, _ = self.request("POST", "/api/auth/login", ["x"], form=False)

        self.assertEqual(status, 400, data)
        self.assertFalse(data.get("ok", True))
