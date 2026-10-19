#!/usr/bin/env python3
"""Reading a stored API key back on a second device (bolt-accounts, /api/auth/secrets).

The wizard stores the provider key encrypted on the ACCOUNT so that a second device does not ask
again. Until now the endpoint answered NAMES only, so the second device learned that a key
existed but could never obtain it: the wizard stayed closed and every model request failed for
want of a key. Reading one value back fixes that, and these tests pin the guard rails that make
it safe to allow.

Run (private database, never production):
    set -a; . /etc/bolt-history.env; set +a
    BOLT_ACCOUNTS_TEST_DB=bolt_history_test_keysync BOLT_SECRETS_KEY=<40+ chars> \
        /usr/bin/python3 -m unittest test_secret_read
"""

from __future__ import annotations

import json
import os
import unittest

# The shared base reads BOLT_ACCOUNTS_TEST_DB at import time and points the service at the private
# database. It must be imported BEFORE `handlers`, otherwise the service is configured for
# production first and the base (rightly) refuses to run.
os.environ.setdefault("BOLT_SECRETS_KEY", "test-only-key-" + "k" * 40)

from test_accounts_security import AccountsSecurityBase  # noqa: E402  isort:skip
import accounts_service as svc  # noqa: E402  isort:skip
import handlers  # noqa: E402  isort:skip

KEY_PAYLOAD = json.dumps({"OpenCodeGo": "oc_sk_FAKE-TEST-VALUE-0123456789"})


class SecretReadTest(AccountsSecurityBase):
    def sign_in(self):
        uid, _ = self.make_user("secret")
        token = handlers.create_session(uid, "test", self.ip)

        return uid, token

    def store(self, token, **secrets):
        status, body, _, _ = self.request("PUT", "/api/auth/secrets", secrets, cookie=token)
        self.assertEqual(status, 200, body)

    # --- the behaviour that was missing ---------------------------------------------------

    def test_a_second_device_can_read_the_provider_key_back(self):
        _, token = self.sign_in()
        self.store(token, provider_settings=KEY_PAYLOAD)

        status, body, _, _ = self.request("GET", "/api/auth/secrets?name=provider_settings", cookie=token)

        self.assertEqual(status, 200, body)
        self.assertEqual(body.get("value"), KEY_PAYLOAD)

    def test_reading_a_missing_key_is_a_clean_empty_answer_not_an_error(self):
        _, token = self.sign_in()

        status, body, _, _ = self.request("GET", "/api/auth/secrets?name=provider_settings", cookie=token)

        self.assertEqual(status, 200, body)
        self.assertIsNone(body.get("value"))

    # --- the guard rails ------------------------------------------------------------------

    def test_other_connection_tokens_are_never_readable(self):
        """GitHub / GitLab / Netlify / Vercel / Supabase tokens stay write-only for the browser."""
        _, token = self.sign_in()
        self.store(token, github_connection='{"token":"ghp_SECRET"}', vercel_connection='{"token":"v_SECRET"}')

        for name in ("github_connection", "vercel_connection", "gitlab_connection", "mcp_settings"):
            status, body, _, _ = self.request("GET", "/api/auth/secrets?name=%s" % name, cookie=token)
            self.assertEqual(status, 403, "%s was readable: %s" % (name, body))
            self.assertNotIn("SECRET", json.dumps(body))

    def test_an_unknown_name_is_refused_not_looked_up(self):
        _, token = self.sign_in()

        status, body, _, _ = self.request("GET", "/api/auth/secrets?name=users", cookie=token)

        self.assertEqual(status, 403, body)

    def test_the_listing_still_returns_names_only(self):
        _, token = self.sign_in()
        self.store(token, provider_settings=KEY_PAYLOAD)

        status, body, _, _ = self.request("GET", "/api/auth/secrets", cookie=token)

        self.assertEqual(status, 200, body)
        self.assertEqual(body.get("names"), ["provider_settings"])
        self.assertNotIn("FAKE-TEST-VALUE", json.dumps(body))

    def test_an_anonymous_request_gets_401_and_no_value(self):
        status, body, _, _ = self.request("GET", "/api/auth/secrets?name=provider_settings")

        self.assertEqual(status, 401, body)
        self.assertNotIn("value", body)

    def test_one_account_cannot_read_another_accounts_key(self):
        _, alice = self.sign_in()
        _, bob = self.sign_in()
        self.store(alice, provider_settings=KEY_PAYLOAD)

        status, body, _, _ = self.request("GET", "/api/auth/secrets?name=provider_settings", cookie=bob)

        self.assertEqual(status, 200, body)
        self.assertIsNone(body.get("value"), "bob read alice's key")

    def test_the_value_is_never_cached(self):
        """A key in a proxy or browser cache outlives the session that was allowed to read it."""
        import http.client

        _, token = self.sign_in()
        self.store(token, provider_settings=KEY_PAYLOAD)

        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        conn.request("GET", "/api/auth/secrets?name=provider_settings",
                     headers={"Cookie": "%s=%s" % (svc.COOKIE, token), "X-Real-IP": self.ip})
        response = conn.getresponse()
        response.read()
        cache = response.getheader("Cache-Control") or ""
        conn.close()

        self.assertIn("no-store", cache)

    def test_an_altered_row_answers_an_error_and_echoes_nothing(self):
        """A row that fails authentication must not return garbage, nor leak what is stored."""
        uid, token = self.sign_in()
        self.store(token, provider_settings=KEY_PAYLOAD)
        stored = svc.query(
            "SELECT value FROM user_secrets WHERE user_id = :'u'::uuid AND name = 'provider_settings';",
            {"u": uid},
        )[0][0]
        iv, tag, data = stored.split(".")
        tampered = ".".join([iv, tag, ("A" if data[0] != "A" else "B") + data[1:]])
        svc.query("UPDATE user_secrets SET value = :'v' WHERE user_id = :'u'::uuid AND name = 'provider_settings';",
                  {"v": tampered, "u": uid}, fetch=False)

        status, body, _, _ = self.request("GET", "/api/auth/secrets?name=provider_settings", cookie=token)

        self.assertEqual(status, 500, body)
        self.assertNotIn("value", body)
        self.assertNotIn(tampered, json.dumps(body))

    def test_the_value_is_stored_encrypted_at_rest(self):
        uid, token = self.sign_in()
        self.store(token, provider_settings=KEY_PAYLOAD)

        stored = svc.query(
            "SELECT value FROM user_secrets WHERE user_id = :'u'::uuid AND name = 'provider_settings';",
            {"u": uid},
        )[0][0]

        self.assertNotIn("FAKE-TEST-VALUE", stored)
        self.assertNotIn("OpenCodeGo", stored)


if __name__ == "__main__":
    unittest.main()
