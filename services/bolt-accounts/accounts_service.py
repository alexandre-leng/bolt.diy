#!/usr/bin/env python3
"""bolt-accounts — accounts, sessions and email verification for bolt.diy.

This is the backend half of the account system. The browser never talks to PostgreSQL: every
query happens here, behind a session check performed on the server, because a frontend flag
saying "logged in" is not an authorization (the specification is explicit about that).

Endpoints (bound to 127.0.0.1; nginx is the public face):
  GET    /verify                  internal session check used by nginx auth_request
  POST   /api/auth/register       create an account, send the verification email
  POST   /api/auth/login          start a session
  POST   /api/auth/logout         end this session
  GET    /api/auth/me             the authenticated user + profile
  POST   /api/auth/verify-email   consume a verification token
  POST   /api/auth/forgot-password  always answers the same way (no account enumeration)
  POST   /api/auth/reset-password   set a new password, revoke every session
  PATCH  /api/auth/profile        update display name / avatar
  POST   /api/auth/change-password  requires the current password
  POST   /api/auth/change-email   requires the current password, re-verifies
  POST   /api/auth/export         personal data export (RGPD)
  POST   /api/auth/delete-account requires the password, deletes or anonymises the data
  GET    /api/admin/users         admin only, paginated + searchable
  PATCH  /api/admin/users/<id>    admin only: role, suspend/reactivate
  DELETE /api/admin/users/<id>    admin only, refuses to remove the last admin

Passwords: Argon2id, never logged, never returned. Sessions: an opaque token in an HttpOnly
cookie; only its SHA-256 is stored, so a database leak yields no usable session.
"""

from __future__ import annotations

import hashlib
import hmac
import html
import json
import os
import re
import secrets
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

# --------------------------------------------------------------------------- config

HOST = "127.0.0.1"
PORT = int(os.environ.get("BOLT_ACCOUNTS_PORT", "8210"))

PG_HOST = os.environ.get("BOLT_HISTORY_PG_HOST", "127.0.0.1")
PG_PORT = os.environ.get("BOLT_HISTORY_PG_PORT", "5432")
PG_USER = os.environ.get("BOLT_HISTORY_PG_USER", "bolt_history")
PG_DB = os.environ.get("BOLT_HISTORY_PG_DB", "bolt_history")
PG_PASSWORD = os.environ.get("BOLT_HISTORY_PG_PASSWORD", "")

# Deliberately NOT "bolt_session": the bolt-auth service (127.0.0.1:8188) already owns that
# name for the app gate with a different token format. Two services writing the same cookie
# clobber each other and a valid login ends up looping between /login and /dashboard.
COOKIE = os.environ.get("BOLT_ACCOUNTS_COOKIE", "bolt_account_session")
SESSION_SECONDS = int(os.environ.get("BOLT_SESSION_SECONDS", str(30 * 24 * 3600)))
VERIFY_TOKEN_SECONDS = 24 * 3600
RESET_TOKEN_SECONDS = 60 * 60

# Public origin used in emails. Overridable so a staging host does not mail prod links.
PUBLIC_ORIGIN = os.environ.get("BOLT_PUBLIC_ORIGIN", "https://bolt.169-58-18-46.sslip.io")

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "")

MIN_PASSWORD = 12
MAX_BODY = 256 * 1024

# Argon2id, as required. Parameters are stored inside each hash, so raising them later does
# not invalidate existing passwords.
HASHER = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4, hash_len=32, salt_len=16)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

# Small deny-list of passwords that appear in every breach corpus. The document asks for a
# compromised-password check "when available"; offline we can still refuse the obvious ones.
COMMON_PASSWORDS = {
    "password1234", "motdepasse123", "azertyuiop123", "qwertyuiop123",
    "passwordpassword", "123456789012", "administrateur", "motdepasse1234",
}


class DatabaseError(RuntimeError):
    pass


# --------------------------------------------------------------------------- database

def _sql_literal(value):
    if value is None:
        return "NULL"

    return "'" + str(value).replace("\\", "\\\\").replace("'", "''") + "'"


def query(sql, params=None, fetch=True):
    """Run SQL through psql with values as psql variables (never concatenated into the query)."""
    script = ""

    for name, value in (params or {}).items():
        if value is None:
            script += "\\set %s ''\n" % name
        else:
            escaped = str(value).replace("\\", "\\\\").replace("'", "''")
            script += "\\set %s '%s'\n" % (name, escaped)

    script += sql

    args = ["psql", "-h", PG_HOST, "-p", str(PG_PORT), "-U", PG_USER, "-d", PG_DB,
            "-v", "ON_ERROR_STOP=1", "-tA", "-F", "\x1f", "-q", "-f", "-"]

    try:
        result = subprocess.run(args, input=script, capture_output=True, text=True, timeout=30,
                                env=dict(os.environ, PGPASSWORD=PG_PASSWORD))
    except subprocess.TimeoutExpired as exc:
        raise DatabaseError("database timeout") from exc

    if result.returncode != 0:
        raise DatabaseError(result.stderr.strip() or "query failed")

    if not fetch:
        return []

    return [line.split("\x1f") for line in result.stdout.split("\n") if line != ""]


# --------------------------------------------------------------------------- passwords

def hash_password(password: str) -> str:
    return HASHER.hash(password)


def verify_password(password: str, stored: str) -> bool:
    try:
        return HASHER.verify(stored, password)
    except VerifyMismatchError:
        return False
    except Exception:  # noqa: BLE001 - a malformed hash must read as "wrong password"
        return False


def needs_rehash(stored: str) -> bool:
    try:
        return HASHER.check_needs_rehash(stored)
    except Exception:  # noqa: BLE001
        return False


def password_problem(password: str) -> str | None:
    """Return a human message when the password is unacceptable, else None."""
    if len(password) < MIN_PASSWORD:
        return "Le mot de passe doit contenir au moins %d caractères." % MIN_PASSWORD

    # Long passphrases are welcome; only refuse an absurd size that could be a DoS vector.
    if len(password) > 1024:
        return "Le mot de passe est trop long (1024 caractères maximum)."

    if password.lower() in COMMON_PASSWORDS:
        return "Ce mot de passe figure dans les listes de mots de passe compromis. Choisis-en un autre."

    return None


# --------------------------------------------------------------------------- tokens

def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_token() -> tuple[str, str]:
    """A fresh single-use token: the value goes to the user, the hash to the database."""
    raw = secrets.token_urlsafe(32)

    return raw, sha256(raw)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- email

def send_email(to: str, subject: str, text: str, html_body: str) -> tuple[bool, str]:
    """Send through Resend. Returns (ok, detail) — never raises, so a mail failure cannot
    break a registration that already succeeded."""
    if not RESEND_API_KEY or not EMAIL_FROM:
        return False, "email transport not configured"

    body = json.dumps({"from": EMAIL_FROM, "to": to, "subject": subject,
                       "text": text, "html": html_body}).encode()

    req = urllib_request(body)

    try:
        with urllib_request_open(req, RESEND_API_KEY) as response:
            payload = json.loads(response.read().decode() or "{}")
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)[:200]

    return True, payload.get("id", "")


def urllib_request(body):
    # Resend's edge answers 403 "error code: 1010" to urllib's default User-Agent while the
    # exact same payload succeeds via curl. Sending an explicit UA is what makes the API
    # usable from Python at all.
    import urllib.request
    return urllib.request.Request("https://api.resend.com/emails", data=body,
                                  headers={"Authorization": "Bearer %s" % RESEND_API_KEY,
                                           "Content-Type": "application/json",
                                           "User-Agent": "bolt-accounts/1.0",
                                           "Accept": "application/json"})


def urllib_request_open(req, _key):
    import urllib.request
    return urllib.request.urlopen(req, timeout=20)


def email_layout(title: str, body_html: str, cta_label: str = "", cta_url: str = "") -> str:
    button = ""
    if cta_label and cta_url:
        button = ('<p style="margin:28px 0"><a href="%s" style="background:#4f46e5;color:#fff;'
                  'padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:600;'
                  'display:inline-block">%s</a></p>' % (html.escape(cta_url, quote=True), html.escape(cta_label)))

    return """<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f6f7f9;font:16px/1.6 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#16181d">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%%" style="max-width:560px;background:#fff;border:1px solid #dfe2e8;border-radius:16px" cellpadding="0" cellspacing="0">
<tr><td style="padding:32px 28px">
<h1 style="margin:0 0 12px;font-size:20px">%s</h1>
%s
%s
<p style="margin:28px 0 0;color:#5d6370;font-size:13px">Bolt — ton espace de création. Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.</p>
</td></tr></table></td></tr></table></body></html>""" % (html.escape(title), body_html, button)


# --------------------------------------------------------------------------- helpers

def client_ip(handler) -> str:
    return handler.headers.get("X-Real-IP") or handler.client_address[0]


def read_cookie(header: str | None, name: str) -> str | None:
    for part in (header or "").split(";"):
        key, _, value = part.strip().partition("=")
        if key == name:
            return value
    return None


def validate_email(raw: str) -> str | None:
    email = (raw or "").strip().lower()

    if len(email) > 254 or not EMAIL_RE.match(email):
        return None

    return email


def log_event(actor, action, target=None, metadata=None):
    """Audit trail for sensitive operations. Never receives secrets."""
    try:
        query(
            "INSERT INTO audit_logs (actor_user_id, action, target_user_id, metadata) "
            "VALUES (nullif(:'a','')::uuid, :'action', nullif(:'t','')::uuid, nullif(:'m','')::jsonb);",
            {"a": actor, "action": action, "t": target,
             "m": json.dumps(metadata) if metadata else None},
            fetch=False,
        )
    except DatabaseError as exc:
        # An audit write must never take down the user-facing operation.
        print("[audit] write failed: %s" % exc, file=sys.stderr, flush=True)
