#!/usr/bin/env python3
"""Hostile inputs against the secrets endpoints (private test database only)."""

from __future__ import annotations

import json
import os
import unittest

os.environ.setdefault("BOLT_SECRETS_KEY", "test-only-key-" + "k" * 40)

from test_accounts_security import AccountsSecurityBase  # noqa: E402  isort:skip
import accounts_service as svc  # noqa: E402  isort:skip
import handlers  # noqa: E402  isort:skip


class SecretsHostileInputTest(AccountsSecurityBase):
    def sign_in(self):
        uid, _ = self.make_user("hostile")

        return uid, handlers.create_session(uid, "test", self.ip)

    def raw(self, method, path, raw_body, token):
        """Send a body verbatim, so a non-object JSON value reaches the handler."""
        from http.client import HTTPConnection

        conn = HTTPConnection("127.0.0.1", self.port, timeout=30)
        conn.request(method, path, body=raw_body, headers={
            "Content-Type": "application/json", "X-Real-IP": self.ip,
            "Cookie": "%s=%s" % (svc.COOKIE, token),
        })
        response = conn.getresponse()
        body = response.read()
        conn.close()

        try:
            return response.status, json.loads(body.decode() or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            return response.status, {}

    def test_delete_with_a_non_object_body_is_a_400_not_a_crash(self):
        _, token = self.sign_in()

        for body in ('["provider_settings"]', '"provider_settings"', "42", "null", "true"):
            with self.subTest(body=body):
                status, payload = self.raw("DELETE", "/api/auth/secrets", body, token)
                self.assertEqual(status, 400, "%s -> %s %s" % (body, status, payload))

    def test_put_with_a_non_object_body_is_a_400_not_a_crash(self):
        _, token = self.sign_in()

        for body in ('["x"]', '"x"', "42", "null"):
            with self.subTest(body=body):
                status, payload = self.raw("PUT", "/api/auth/secrets", body, token)
                self.assertEqual(status, 400, "%s -> %s %s" % (body, status, payload))

    def test_deleting_a_secret_that_was_never_stored_reports_zero_removed(self):
        _, token = self.sign_in()

        status, payload, _, _ = self.request("DELETE", "/api/auth/secrets", {"name": "github_connection"}, cookie=token)

        self.assertEqual(status, 200, payload)
        self.assertEqual(payload.get("removed"), 0, "reported a removal that never happened: %s" % payload)

    def test_deleting_a_stored_secret_reports_one_removed_and_it_is_gone(self):
        _, token = self.sign_in()
        self.request("PUT", "/api/auth/secrets", {"github_connection": '{"token":"x"}'}, cookie=token)

        status, payload, _, _ = self.request("DELETE", "/api/auth/secrets", {"name": "github_connection"}, cookie=token)

        self.assertEqual(payload.get("removed"), 1, payload)
        self.assertNotIn("github_connection", payload.get("names", []))

    def test_an_oversized_secret_is_refused_with_a_400(self):
        _, token = self.sign_in()

        status, payload, _, _ = self.request(
            "PUT", "/api/auth/secrets", {"provider_settings": "k" * (handlers.MAX_SECRET_BYTES + 10)}, cookie=token)

        self.assertEqual(status, 400, payload)

    def test_a_secret_with_hostile_text_round_trips_exactly(self):
        """Quotes, backslashes, newlines, NUL-adjacent and unicode survive encryption intact."""
        _, token = self.sign_in()
        hostile = json.dumps({"OpenCodeGo": "k'\"\\\\x1f\n\t\u00e9\u65e5\U0001f680;DROP TABLE users;--"})
        self.request("PUT", "/api/auth/secrets", {"provider_settings": hostile}, cookie=token)

        status, payload, _, _ = self.request("GET", "/api/auth/secrets?name=provider_settings", cookie=token)

        self.assertEqual(status, 200, payload)
        self.assertEqual(payload.get("value"), hostile)

    def test_the_name_parameter_cannot_be_used_to_inject_or_traverse(self):
        _, token = self.sign_in()

        for name in ("provider_settings'; DROP TABLE user_secrets;--", "../etc/passwd", "provider_settings%00",
                     "PROVIDER_SETTINGS", " provider_settings x", "provider_settings&name=github_connection"):
            with self.subTest(name=name):
                from urllib.parse import quote
                status, payload, _, _ = self.request("GET", "/api/auth/secrets?name=" + quote(name), cookie=token)
                self.assertIn(status, (200, 403), "%r -> %s %s" % (name, status, payload))
                self.assertNotIn("github_connection", json.dumps(payload))

        still_there = svc.query("SELECT count(*)::text FROM information_schema.tables WHERE table_name='user_secrets';")
        self.assertEqual(still_there[0][0], "1", "the table is gone")

    def test_a_repeated_name_parameter_cannot_smuggle_a_second_secret(self):
        _, token = self.sign_in()
        self.request("PUT", "/api/auth/secrets", {"github_connection": '{"token":"ghp_SECRET"}'}, cookie=token)

        status, payload, _, _ = self.request(
            "GET", "/api/auth/secrets?name=provider_settings&name=github_connection", cookie=token)

        self.assertNotIn("ghp_SECRET", json.dumps(payload))


if __name__ == "__main__":
    unittest.main()
