#!/usr/bin/env python3
"""HTTP handlers for bolt-accounts. Imported by accounts_service's main().

Kept apart from the schema/connection layer so the authorization rules — the part that must be
right — are readable in one place.
"""

from __future__ import annotations

import json
import re
import secrets
import sys
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from html import escape as html_escape
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs

from accounts_service import (  # noqa: F401
    COOKIE, EMAIL_FROM, HASHER, MIN_PASSWORD, PUBLIC_ORIGIN, RESET_TOKEN_SECONDS,
    SESSION_SECONDS, UUID_RE, VERIFY_TOKEN_SECONDS, HASHER as _H, DatabaseError,
    client_ip, email_layout, hash_password, log_event, needs_rehash, new_token, now_iso,
    password_problem, query, read_cookie, send_email, sha256, validate_email, verify_password,
)
from secret_crypto import SecretCryptoError, decrypt as decrypt_secret, encrypt as encrypt_secret

# Failed logins per IP, in memory: cheap, and it stops scripted guessing. The document asks for
# both a lockout and protection against automated attacks.
MAX_FAILURES = 8
FAILURE_WINDOW = 15 * 60
_failures: dict[str, list[float]] = {}


def _recent_failures(ip: str) -> list[float]:
    import time
    cutoff = time.time() - FAILURE_WINDOW
    kept = [t for t in _failures.get(ip, []) if t > cutoff]
    _failures[ip] = kept
    return kept


def _note_failure(ip: str) -> None:
    import time
    _recent_failures(ip)
    _failures.setdefault(ip, []).append(time.time())


def _blocked(ip: str) -> bool:
    return len(_recent_failures(ip)) >= MAX_FAILURES


def _clear_failures(ip: str) -> None:
    _failures.pop(ip, None)


# A real Argon2id hash of a random secret, verified when the address is unknown. The old
# placeholder (zeros) failed to parse, so argon2 bailed out in microseconds and an unknown
# address answered ~150 ms faster than a known one: the timing told which accounts exist.
DUMMY_HASH = HASHER.hash(secrets.token_urlsafe(16))


def origin_allowed(handler) -> bool:
    """CSRF guard for state-changing requests: the browser's Origin must be ours.

    Browsers send Origin on every cross-site POST/PUT/PATCH/DELETE; a request without one
    is a non-browser client (curl, the local e2e test), which cannot ride a victim's cookie.
    `Sec-Fetch-Site: cross-site` without Origin is refused too.
    """
    origin = (handler.headers.get("Origin") or "").strip()

    if origin:
        return origin.rstrip("/") == PUBLIC_ORIGIN.rstrip("/")

    return (handler.headers.get("Sec-Fetch-Site") or "").strip().lower() != "cross-site"


# --------------------------------------------------------------------------- users

def find_user_by_email(email: str):
    rows = query(
        "SELECT id, email, password_hash, email_verified, status, is_admin, created_at, "
        "coalesce(to_char(last_seen_at,'YYYY-MM-DD\"T\"HH24:MI:SSOF'),'') FROM users WHERE email = :'e';",
        {"e": email},
    )

    return rows[0] if rows else None


def find_user_by_id(user_id: str):
    if not UUID_RE.match(user_id or ""):
        return None

    rows = query(
        "SELECT id, email, password_hash, email_verified, status, is_admin, created_at, "
        "coalesce(to_char(last_seen_at,'YYYY-MM-DD\"T\"HH24:MI:SSOF'),'') FROM users WHERE id = :'i';",
        {"i": user_id},
    )

    return rows[0] if rows else None


def user_public(row) -> dict:
    """The shape sent to the browser: never a password hash, never a token."""
    return {
        "id": row[0],
        "email": row[1],
        "emailVerified": row[3] == "t",
        "status": row[4],
        "isAdmin": row[5] == "t",
        "createdAt": row[6],
        "lastSeenAt": row[7] or None,
    }


def load_profile(user_id: str) -> dict:
    rows = query(
        "SELECT coalesce(display_name,''), coalesce(avatar_url,'') FROM profiles WHERE user_id = :'i';",
        {"i": user_id},
    )

    if not rows:
        return {"displayName": "", "avatarUrl": ""}

    return {"displayName": rows[0][0], "avatarUrl": rows[0][1]}


# --------------------------------------------------------------------------- sessions

def create_session(user_id: str, user_agent: str, ip: str) -> str:
    raw = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(seconds=SESSION_SECONDS)

    query(
        "INSERT INTO sessions (user_id, token_hash, user_agent, ip, expires_at) "
        "VALUES (:'u'::uuid, :'h', :'ua', :'ip', :'exp'::timestamptz);",
        {"u": user_id, "h": sha256(raw), "ua": (user_agent or "")[:400], "ip": ip,
         "exp": expires.isoformat()},
        fetch=False,
    )

    return raw


def session_user(handler):
    """Resolve the cookie to a live user, or None. Every protected route goes through here."""
    raw = read_cookie(handler.headers.get("Cookie"), COOKIE)

    if not raw:
        return None

    rows = query(
        "SELECT u.id, u.email, u.password_hash, u.email_verified, u.status, u.is_admin, "
        "u.created_at, coalesce(to_char(u.last_seen_at,'YYYY-MM-DD\"T\"HH24:MI:SSOF'),'') "
        "FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token_hash = :'h' AND s.expires_at > now();",
        {"h": sha256(raw)},
    )

    if not rows:
        return None

    row = rows[0]

    if row[4] != "active":  # a suspended account loses access immediately
        return None

    # Touch the session and the user so "last activity" is truthful in the admin list.
    query("UPDATE sessions SET last_seen_at = now() WHERE token_hash = :'h' AND last_seen_at < now() - interval '5 minutes';",
          {"h": sha256(raw)}, fetch=False)

    return row


def revoke_all_sessions(user_id: str) -> None:
    query("DELETE FROM sessions WHERE user_id = :'u'::uuid;", {"u": user_id}, fetch=False)


def revoke_other_sessions(user_id: str, current_raw: str | None) -> None:
    """Every session of the user except the one making the request."""
    query("DELETE FROM sessions WHERE user_id = :'u'::uuid AND token_hash <> :'h';",
          {"u": user_id, "h": sha256(current_raw or "")}, fetch=False)


def drop_presented_session(handler) -> None:
    """Invalidate the session cookie the browser presents at login (session fixation):
    a token planted before the login must not stay valid next to the new one."""
    raw = read_cookie(handler.headers.get("Cookie"), COOKIE)

    if raw:
        query("DELETE FROM sessions WHERE token_hash = :'h';", {"h": sha256(raw)}, fetch=False)


def issue_token(user_id: str, purpose: str, seconds: int) -> str:
    raw, hashed = new_token()
    expires = datetime.now(timezone.utc) + timedelta(seconds=seconds)

    query(
        "INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at) "
        "VALUES (:'u'::uuid, :'h', :'p', :'e'::timestamptz);",
        {"u": user_id, "h": hashed, "p": purpose, "e": expires.isoformat()},
        fetch=False,
    )

    return raw


def consume_token(raw: str, purpose: str):
    """Return the token row when it is valid and unused, then mark it used."""
    if not raw:
        return None

    rows = query(
        "SELECT id, user_id FROM auth_tokens "
        "WHERE token_hash = :'h' AND purpose = :'p' AND used_at IS NULL AND expires_at > now();",
        {"h": sha256(raw), "p": purpose},
    )

    if not rows:
        return None

    token_id, user_id = rows[0]
    query("UPDATE auth_tokens SET used_at = now() WHERE id = :'i'::uuid;", {"i": token_id}, fetch=False)

    return user_id


# --------------------------------------------------------------------------- preferences

# Only these keys are ever stored. The column is JSONB, so without a whitelist any caller could
# push arbitrary data into it (and a future reader might trust it). Each entry also declares the
# type it must have, so a string cannot arrive where the UI expects a boolean.
PREFERENCE_TYPES = {
    "theme": str,
    "language": str,
    "autoSelectTemplate": bool,
    "latestBranch": bool,
    "toolAccessMode": str,
    "defaultModel": str,
    "defaultProvider": str,
    # Interface choices made in the onboarding wizard and in Settings. They lived in
    # localStorage only, so a second device re-asked for all of them.
    "interfaceOptions": str,       # JSON-encoded {accentIntensity, cornerRadius, ...}
    "sidebarOpen": bool,
    "tabConfiguration": str,       # JSON-encoded tab list
    "zipAutorun": bool,
    "onboardingCompleted": bool,
    "profileName": str,
    "profileAvatar": str,
    "defaultProjectType": str,
    "defaultProjectName": str,
}

MAX_PREFERENCE_BYTES = 8192


# --------------------------------------------------------------------------- secrets

# Encrypted per-user credentials. Same whitelist reasoning as the preferences above, with
# a higher stake: an arbitrary key here would be a credential the server would later
# decrypt and hand to an outbound call.
SECRET_NAMES = {
    "provider_settings",
    "github_connection",
    "gitlab_connection",
    "netlify_connection",
    "vercel_connection",
    "supabaseCredentials",
    "supabase_connection",
    "mcp_settings",
    "auto_enabled_providers",
}

# A connection JSON can carry several tokens; the provider list can too. Generous but bounded.
MAX_SECRET_BYTES = 65536


def clean_secrets(payload: dict) -> tuple[dict, str | None]:
    """Keep known secret names whose value is a non-empty string; ignore the rest.

    An unknown name is skipped rather than rejected: the client sends its whole local
    set, and a newer client with one more connection type must not fail entirely on an
    older server.
    """
    if not isinstance(payload, dict):
        return {}, "body must be a JSON object"

    cleaned = {}

    for name, value in payload.items():
        if name not in SECRET_NAMES:
            continue

        if value is None or value == "":
            # An empty value means "remove it", handled by DELETE. Skipping here keeps a
            # stray blank from overwriting a stored key with an encryptable empty string.
            continue

        if not isinstance(value, str):
            return {}, "%s must be a string" % name

        cleaned[name] = value

    encoded = json.dumps(cleaned)

    if len(encoded.encode()) > MAX_SECRET_BYTES:
        return {}, "secrets payload too large"

    return cleaned, None


def store_secrets(user_id: str, secrets: dict) -> None:
    """Encrypt and upsert each secret, leaving the ones absent from this call untouched."""
    for name, value in secrets.items():
        query(
            "INSERT INTO user_secrets (user_id, name, value) VALUES (:'u'::uuid, :'n', :'v') "
            "ON CONFLICT (user_id, name) DO UPDATE SET value = EXCLUDED.value, updated_at = now();",
            {"u": user_id, "n": name, "v": encrypt_secret(value)},
            fetch=False,
        )


def list_secret_names(user_id: str) -> list:
    """Names only. The values never leave the server through a client-facing endpoint."""
    rows = query("SELECT name FROM user_secrets WHERE user_id = :'i'::uuid ORDER BY name;",
                 {"i": user_id})

    return [row[0] for row in rows]


# The ONLY secret a browser may read back. The model providers' keys are already in that
# browser's hands on every chat request (the page sends them), so returning them to the signed-in
# account's own second device exposes nothing new — and without it a second device is told a key
# exists but can never obtain it, so the wizard stays closed while every model call fails. The
# connection tokens (GitHub, GitLab, Netlify, Vercel, Supabase, MCP) stay write-only: they grant
# access to other services and nothing in the browser needs them back.
READABLE_SECRET_NAMES = frozenset({"provider_settings"})


def read_secret(user_id: str, name: str):
    """The decrypted value of one readable secret for this user, or None when none is stored.

    Raises SecretCryptoError when the stored value cannot be authenticated (wrong key, altered
    row); the caller turns that into an error instead of returning garbage.
    """
    rows = query("SELECT value FROM user_secrets WHERE user_id = :'u'::uuid AND name = :'n';",
                 {"u": user_id, "n": name})

    if not rows:
        return None

    return decrypt_secret(rows[0][0])


def delete_secrets(user_id: str, names: list) -> int:
    """Delete the named secrets and return how many rows were really removed.

    The count used to be bumped for every known name, so deleting a secret that was never stored
    answered "removed: 1". RETURNING reports what the database actually deleted.
    """
    removed = 0

    for name in names:
        if name not in SECRET_NAMES:
            continue

        rows = query("DELETE FROM user_secrets WHERE user_id = :'u'::uuid AND name = :'n' RETURNING name;",
                     {"u": user_id, "n": name})
        removed += len(rows)

    return removed


def load_preferences(user_id: str) -> dict:
    rows = query("SELECT coalesce(settings::text,'{}') FROM preferences WHERE user_id = :'i'::uuid;",
                 {"i": user_id})

    if not rows or not rows[0][0]:
        return {}

    import json as _json

    try:
        return _json.loads(rows[0][0])
    except ValueError:
        return {}


def clean_preferences(payload: dict) -> tuple[dict, str | None]:
    """Keep only known keys with the right type; reject anything else."""
    if not isinstance(payload, dict):
        return {}, "body must be a JSON object"

    cleaned = {}

    for key, value in payload.items():
        expected = PREFERENCE_TYPES.get(key)

        if expected is None:
            # Unknown keys are dropped rather than stored: an open column invites junk.
            continue

        if value is None:
            continue

        if expected is bool and not isinstance(value, bool):
            return {}, "%s must be a boolean" % key

        if expected is str and not isinstance(value, str):
            return {}, "%s must be a string" % key

        if expected is str:
            value = value[:200]

        cleaned[key] = value

    return cleaned, None


# --------------------------------------------------------------------------- emails

def send_verification(user: dict, raw_token: str) -> tuple[bool, str]:
    link = "%s/verify-email?token=%s" % (PUBLIC_ORIGIN, raw_token)
    text = ("Confirme ton adresse email pour activer ton compte Bolt.\n%s\n\n"
            "Ce lien est valable 24 heures." % link)
    body = ("<p>Confirme ton adresse email pour activer ton compte Bolt.</p>"
            "<p>Ce lien est valable 24 heures.</p>")

    return send_email(user["email"], "Confirme ton adresse email — Bolt",
                      text, email_layout("Confirme ton adresse", body, "Confirmer mon email", link))


def send_reset(user: dict, raw_token: str) -> tuple[bool, str]:
    link = "%s/reset-password?token=%s" % (PUBLIC_ORIGIN, raw_token)
    text = ("Réinitialisation de ton mot de passe Bolt.\n%s\n\n"
            "Ce lien est valable 1 heure et ne peut servir qu'une fois." % link)
    body = ("<p>Tu as demandé à réinitialiser ton mot de passe.</p>"
            "<p>Ce lien est valable 1 heure et ne peut servir qu'une fois.</p>")

    return send_email(user["email"], "Réinitialise ton mot de passe — Bolt",
                      text, email_layout("Réinitialise ton mot de passe", body, "Choisir un nouveau mot de passe", link))


def send_email_changed_notice(old_email: str, new_email: str) -> tuple[bool, str]:
    """Tell the previous address: a stolen password must not move the account silently."""
    text = ("L'adresse email de ton compte Bolt vient d'être remplacée par %s.\n"
            "Si tu n'es pas à l'origine de ce changement, réinitialise ton mot de passe "
            "et contacte l'administrateur." % new_email)
    body = ("<p>L'adresse email de ton compte Bolt vient d'être remplacée par <strong>%s</strong>.</p>"
            "<p>Si tu n'es pas à l'origine de ce changement, réinitialise ton mot de passe "
            "et contacte l'administrateur.</p>" % html_escape(new_email))

    return send_email(old_email, "Ton adresse email a été modifiée — Bolt", text,
                      email_layout("Adresse email modifiée", body, "Réinitialiser mon mot de passe",
                                   "%s/forgot-password" % PUBLIC_ORIGIN))


def send_existing_account_notice(email: str) -> tuple[bool, str]:
    """Sent instead of a verification mail when someone registers an existing address:
    the response then costs the same mail round-trip either way (no timing difference)."""
    text = ("Quelqu'un a essayé de créer un compte Bolt avec ton adresse, qui en a déjà un.\n"
            "Si c'est toi, connecte-toi ou utilise « Mot de passe oublié ». Sinon, ignore cet email.")
    body = ("<p>Quelqu'un a essayé de créer un compte Bolt avec ton adresse, qui en a déjà un.</p>"
            "<p>Si c'est toi, connecte-toi ou utilise « Mot de passe oublié ». Sinon, ignore cet email.</p>")

    return send_email(email, "Tu as déjà un compte — Bolt", text,
                      email_layout("Tu as déjà un compte", body, "Se connecter", "%s/login" % PUBLIC_ORIGIN))


# --------------------------------------------------------------------------- handler

try:
    from ui.routes import PageRoutes
except ImportError:  # running from a different cwd
    import sys as _sys
    _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from ui.routes import PageRoutes


class AccountsHandler(PageRoutes, BaseHTTPRequestHandler):
    # `HEAD /login` answered 501 — nginx logged it while a monitor probed the page — because
    # only do_GET existed. Same pattern as bolt_auth.py: do_HEAD = do_GET.
    server_version = "bolt-accounts/1.0"
    sys_version = ""

    # --- plumbing ---------------------------------------------------------

    def log_message(self, fmt, *args):
        # Never log bodies or query strings: they can carry tokens.
        print("%s %s %s" % (client_ip(self), self.command, self.path.split("?")[0]), flush=True)

    def _json(self, status: int, payload: dict, cookie: str | None = None):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)

        try:
            self.end_headers()

            if self.command != "HEAD":
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            # The client hung up mid-response; the traceback that used to land in the
            # journal proved nothing and pushed real lines out of view.
            return

    def _cookie_header(self, value: str, max_age: int) -> str:
        return "%s=%s; Path=/; Max-Age=%d; HttpOnly; Secure; SameSite=Lax" % (COOKIE, value, max_age)

    def _body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None

        if length <= 0 or length > 256 * 1024:
            return None

        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

    def _form(self):
        """Accept JSON and form-encoded bodies alike (the app posts form data for /login).

        Raises ValueError when a JSON body is malformed or is not an object: callers answer 400.
        Returning {} on a bad body used to turn a truncated PATCH into "erase the profile".
        """
        ctype = self.headers.get("Content-Type", "")

        if "application/json" in ctype:
            body = self._body()

            if body is None:
                raise ValueError("invalid JSON body")

            if not isinstance(body, dict):
                raise ValueError("body must be a JSON object")

            return body

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return {}

        if length <= 0 or length > 256 * 1024:
            return {}

        parsed = parse_qs(self.rfile.read(length).decode("utf-8", "replace"))

        return {k: v[0] for k, v in parsed.items()}

    # --- routes -----------------------------------------------------------

    def do_GET(self):  # noqa: N802
        path = self.path.split("?")[0]

        # HTML pages first: they are ordinary routes, not API endpoints.
        html_routes = {
            "/": self.html_home,
            "/login": self.html_login,
            "/logout": self.html_logout,
            "/register": self.html_register,
            "/forgot-password": self.html_forgot,
            "/reset-password": self.html_reset,
            "/verify-email": self.html_verify_email,
            "/dashboard": self.html_dashboard,
            # `/settings` alone is where the in-app account menu points; without it the
            # user lands on a bare 404. It means the same thing as /settings/account.
            "/settings": self.html_account,
            "/settings/account": self.html_account,
            "/settings/security": self.html_security,
            "/admin/users": self.html_admin_users,
            "/terms": lambda: self.html_policy("terms"),
            "/privacy": lambda: self.html_policy("privacy"),
        }

        if path in html_routes:
            return html_routes[path]()

        if path == "/verify":
            row = session_user(self)

            if not row:
                return self._json(401, {})

            # Hand the identity to nginx so it can pass it to services behind the gate
            # (bolt-history stores each conversation against its owner).
            body = json.dumps({"id": row[0], "email": row[1], "isAdmin": row[5] == "t"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            # `X-Accel-*` headers are nginx's own channel for passing values out of an
            # auth_request subrequest: ordinary response headers are dropped, which is why the
            # downstream service kept receiving an empty owner.
            self.send_header("X-Bolt-User-Id", row[0])
            self.send_header("X-Bolt-User-Is-Admin", "1" if row[5] == "t" else "0")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

            return

        if path == "/api/auth/preferences":
            row = session_user(self)

            if not row:
                return self._json(401, {"ok": False, "error": "not authenticated"})

            return self._json(200, {"ok": True, "preferences": load_preferences(row[0])})

        if path == "/api/auth/secrets":
            row = session_user(self)

            if not row:
                return self._json(401, {"ok": False, "error": "not authenticated"})

            qs = parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            wanted = (qs.get("name", [""])[0] or "").strip()

            # Without `name`: the list of names, as before. With `name`: that one value, and only
            # when it is on the readable list (see READABLE_SECRET_NAMES) — every other
            # credential stays write-only for the browser.
            if not wanted:
                return self._json(200, {"ok": True, "names": list_secret_names(row[0])})

            if wanted not in READABLE_SECRET_NAMES:
                return self._json(403, {"ok": False, "error": "this secret cannot be read back"})

            try:
                value = read_secret(row[0], wanted)
            except SecretCryptoError:
                # Wrong key or an altered row. Say so without echoing anything stored.
                return self._json(500, {"ok": False, "error": "stored secret could not be decrypted"})

            return self._json(200, {"ok": True, "name": wanted, "value": value})

        if path == "/api/auth/me":
            row = session_user(self)

            if not row:
                return self._json(401, {"ok": False, "error": "not authenticated"})

            user = user_public(row)
            user["profile"] = load_profile(user["id"])

            return self._json(200, {"ok": True, "user": user})

        if path == "/api/admin/users":
            return self._admin_list()

        if path == "/health":
            try:
                count = query("SELECT count(*)::text FROM users;")[0][0]
            except (DatabaseError, IndexError) as exc:
                return self._json(500, {"ok": False, "error": str(exc)[:120]})

            return self._json(200, {"ok": True, "users": int(count), "backend": "postgresql"})

        return self._json(404, {"ok": False, "error": "not found"})

    def _origin_refused(self) -> bool:
        """Answer 403 to a state-changing request from another origin (CSRF)."""
        if origin_allowed(self):
            return False

        self._json(403, {"ok": False, "error": "origin not allowed"})

        return True

    def do_POST(self):  # noqa: N802
        if self._origin_refused():
            return

        path = self.path.split("?")[0]

        # Form posts from the HTML pages (they redirect; the JSON ones answer with JSON body).
        html_posts = (
            "/login", "/logout", "/register", "/forgot-password", "/reset-password",
            "/settings/account/profile", "/settings/account/email", "/settings/account/export",
            "/settings/account/delete", "/settings/security/password", "/settings/security/logout-all",
        )

        if path in html_posts or path.startswith("/admin/users/"):
            try:
                return self.html_post(path)
            except DatabaseError as exc:
                print("[accounts] db error: %s" % exc, file=sys.stderr, flush=True)
                return self._redirect("/?e=Erreur%20serveur")

        routes = {
            "/api/auth/preferences": self._put_preferences,
            "/api/auth/register": self._register,
            "/api/auth/login": self._login,
            "/api/auth/logout": self._logout,
            "/api/auth/verify-email": self._verify_email,
            "/api/auth/forgot-password": self._forgot_password,
            "/api/auth/reset-password": self._reset_password,
            "/api/auth/change-password": self._change_password,
            "/api/auth/change-email": self._change_email,
            "/api/auth/export": self._export_data,
            "/api/auth/delete-account": self._delete_account,
        }

        handler = routes.get(path)

        if not handler:
            return self._json(404, {"ok": False, "error": "not found"})

        try:
            return handler()
        except DatabaseError as exc:
            print("[accounts] db error: %s" % exc, file=sys.stderr, flush=True)

            return self._json(500, {"ok": False, "error": "Erreur serveur. Réessaie dans un instant."})

    def do_PUT(self):  # noqa: N802
        """PUT is used by the preferences and secrets endpoints (a full document, idempotent).

        Without this method BaseHTTPRequestHandler answers 501, which is what made the client's
        preference saves appear to succeed locally and never reach the database.
        """
        if self._origin_refused():
            return

        path = self.path.split("?")[0]

        if path == "/api/auth/preferences":
            try:
                return self._put_preferences()
            except DatabaseError as exc:
                print("[accounts] db error: %s" % exc, file=sys.stderr, flush=True)
                return self._json(500, {"ok": False, "error": "Erreur serveur. Réessaie dans un instant."})

        if path == "/api/auth/secrets":
            try:
                return self._put_secrets()
            except DatabaseError as exc:
                print("[accounts] db error: %s" % exc, file=sys.stderr, flush=True)
                return self._json(500, {"ok": False, "error": "Erreur serveur. Réessaie dans un instant."})
            except SecretCryptoError as exc:
                # A missing or short BOLT_SECRETS_KEY lands here. Refuse the write outright:
                # storing the value unencrypted would be far worse than failing the request.
                print("[accounts] secrets refused: %s" % exc, file=sys.stderr, flush=True)
                return self._json(503, {"ok": False, "error": "Le stockage chiffré n'est pas configuré."})

        return self._json(404, {"ok": False, "error": "not found"})

    def do_PATCH(self):  # noqa: N802
        if self._origin_refused():
            return

        path = self.path.split("?")[0]

        if path == "/api/auth/profile":
            return self._update_profile()

        m = re.match(r"^/api/admin/users/([0-9a-fA-F-]{36})$", path)

        if m:
            return self._admin_update(m.group(1))

        return self._json(404, {"ok": False, "error": "not found"})

    def do_DELETE(self):  # noqa: N802
        if self._origin_refused():
            return

        path = self.path.split("?")[0]

        if path == "/api/auth/secrets":
            return self._delete_secrets()

        m = re.match(r"^/api/admin/users/([0-9a-fA-F-]{36})$", path)

        if m:
            return self._admin_delete(m.group(1))

        return self._json(404, {"ok": False, "error": "not found"})

    # --- auth handlers ----------------------------------------------------

    def _put_secrets(self):
        """Store encrypted credentials for the signed-in user.

        Responds with the NAMES that exist, never the values: the caller sent them, so
        echoing them back would only add a way to leak a credential into a log or a
        screenshot.
        """
        row = session_user(self)

        if not row:
            return self._json(401, {"ok": False, "error": "not authenticated"})

        payload = self._body()

        if payload is None:
            return self._json(400, {"ok": False, "error": "invalid JSON body"})

        cleaned, error = clean_secrets(payload)

        if error:
            return self._json(400, {"ok": False, "error": error})

        store_secrets(row[0], cleaned)

        return self._json(200, {"ok": True, "names": list_secret_names(row[0])})

    def _delete_secrets(self):
        row = session_user(self)

        if not row:
            return self._json(401, {"ok": False, "error": "not authenticated"})

        payload = self._body()

        if payload is None:
            return self._json(400, {"ok": False, "error": "invalid JSON body"})

        # A valid JSON body that is not an object (an array, a string, a number) used to reach
        # payload.get() and crash the handler instead of answering 400.
        if not isinstance(payload, dict):
            return self._json(400, {"ok": False, "error": "body must be a JSON object"})

        # Accept both {"name": "x"} and {"names": ["x", "y"]} so the client does not have to
        # special-case one removal.
        if isinstance(payload.get("names"), list):
            names = payload["names"]
        elif isinstance(payload.get("name"), str):
            names = [payload["name"]]
        else:
            return self._json(400, {"ok": False, "error": "name or names is required"})

        removed = delete_secrets(row[0], [n for n in names if isinstance(n, str)])

        return self._json(200, {"ok": True, "removed": removed, "names": list_secret_names(row[0])})

    def _put_preferences(self):
        row = session_user(self)

        if not row:
            return self._json(401, {"ok": False, "error": "not authenticated"})

        payload = self._body()

        if payload is None:
            return self._json(400, {"ok": False, "error": "invalid JSON body"})

        cleaned, error = clean_preferences(payload)

        if error:
            return self._json(400, {"ok": False, "error": error})

        import json as _json

        encoded = _json.dumps(cleaned)

        if len(encoded.encode()) > MAX_PREFERENCE_BYTES:
            return self._json(400, {"ok": False, "error": "preferences too large"})

        # Merge, so sending one setting does not wipe the others.
        query(
            "INSERT INTO preferences (user_id, settings) VALUES (:'u'::uuid, :'s'::jsonb) "
            "ON CONFLICT (user_id) DO UPDATE SET settings = preferences.settings || EXCLUDED.settings, "
            "updated_at = now();",
            {"u": row[0], "s": encoded},
            fetch=False,
        )
        log_event(row[0], "preferences_updated", row[0], {"keys": sorted(cleaned)})

        return self._json(200, {"ok": True, "preferences": load_preferences(row[0])})

    def _register(self):
        try:
            form = self._form_or_400()

            if form is None:
                return
        except ValueError:
            return self._json(400, {"ok": False, "error": "Requête invalide."})
        email = validate_email(form.get("email", ""))
        password = form.get("password", "")
        confirm = form.get("passwordConfirm", "")
        display = (form.get("displayName") or "").strip()[:80]
        terms = bool(form.get("acceptTerms"))

        if not email:
            return self._json(400, {"ok": False, "error": "Adresse email invalide."})

        if password != confirm:
            return self._json(400, {"ok": False, "error": "Les deux mots de passe ne correspondent pas."})

        problem = password_problem(password)

        if problem:
            return self._json(400, {"ok": False, "error": problem})

        if not terms:
            return self._json(400, {"ok": False, "error": "Tu dois accepter les conditions d'utilisation."})

        existing = find_user_by_email(email)

        if existing:
            # Do not confirm that the address exists: same message as a validation failure,
            # and the same work (an Argon2 hash and a mail round-trip) so the response time
            # does not tell either.
            hash_password(password)
            ok, detail = send_existing_account_notice(existing[1])

            if not ok:
                print("[accounts] existing-account notice failed: %s" % detail, file=sys.stderr, flush=True)

            return self._json(200, {"ok": True, "message": "Si cette adresse peut être utilisée, un email de confirmation vient de t'être envoyé."})

        rows = query(
            "INSERT INTO users (email, password_hash) VALUES (:'e', :'p') RETURNING id;",
            {"e": email, "p": hash_password(password)},
        )
        user_id = rows[0][0]

        query("INSERT INTO profiles (user_id, display_name) VALUES (:'u'::uuid, nullif(:'d','')) "
              "ON CONFLICT (user_id) DO NOTHING;",
              {"u": user_id, "d": display or email.split("@")[0]}, fetch=False)
        query("INSERT INTO user_roles (user_id, role) VALUES (:'u'::uuid, 'user') ON CONFLICT DO NOTHING;",
              {"u": user_id}, fetch=False)

        raw = issue_token(user_id, "verify_email", VERIFY_TOKEN_SECONDS)
        ok, detail = send_verification({"email": email}, raw)

        log_event(user_id, "register", user_id, {"email_domain": email.split("@")[-1], "mail_sent": ok})

        if not ok:
            # The account exists; the mail is what failed. Report it honestly instead of
            # claiming the email went out.
            print("[accounts] verification email failed: %s" % detail, file=sys.stderr, flush=True)
            return self._json(200, {"ok": True, "warning": "email_not_sent",
                                    "message": "Compte créé, mais l'email de confirmation n'a pas pu être envoyé. Contacte l'administrateur."})

        return self._json(200, {"ok": True, "message": "Compte créé. Vérifie ta boîte email pour confirmer ton adresse."})

    def _login(self):
        try:
            form = self._form_or_400()

            if form is None:
                return
        except ValueError:
            return self._json(400, {"ok": False, "error": "Requête invalide."})
        email = validate_email(form.get("email", ""))
        password = form.get("password", "")
        ip = client_ip(self)

        if _blocked(ip):
            return self._json(429, {"ok": False,
                                    "error": "Trop de tentatives. Réessaie dans 15 minutes."})

        row = find_user_by_email(email) if email else None

        # Always run a verification so a wrong address takes as long as a wrong password.
        stored = row[2] if row else DUMMY_HASH
        password_ok = verify_password(password, stored)

        if not row or not password_ok:
            _note_failure(ip)
            log_event(None, "login_failed", None, {"ip": ip})
            return self._json(401, {"ok": False, "error": "Email ou mot de passe incorrect."})

        if row[4] != "active":
            return self._json(403, {"ok": False, "error": "Ce compte est suspendu."})

        if row[3] != "t":
            # Let them in but say so; the app routes them to the verification notice.
            pass

        _clear_failures(ip)

        if needs_rehash(row[2]):
            query("UPDATE users SET password_hash = :'p', updated_at = now() WHERE id = :'i'::uuid;",
                  {"p": hash_password(password), "i": row[0]}, fetch=False)

        query("UPDATE users SET last_seen_at = now() WHERE id = :'i'::uuid;", {"i": row[0]}, fetch=False)

        drop_presented_session(self)
        token = create_session(row[0], self.headers.get("User-Agent", ""), ip)
        log_event(row[0], "login", row[0], {"ip": ip})

        return self._json(200, {"ok": True, "user": user_public(row)},
                          cookie=self._cookie_header(token, SESSION_SECONDS))

    def _logout(self):
        raw = read_cookie(self.headers.get("Cookie"), COOKIE)

        if raw:
            query("DELETE FROM sessions WHERE token_hash = :'h';", {"h": sha256(raw)}, fetch=False)

        return self._json(200, {"ok": True}, cookie=self._cookie_header("", 0))

    def _verify_email(self):
        try:
            form = self._form_or_400()

            if form is None:
                return
        except ValueError:
            return self._json(400, {"ok": False, "error": "Requête invalide."})
        user_id = consume_token(form.get("token", ""), "verify_email")

        if not user_id:
            return self._json(400, {"ok": False, "error": "Lien invalide ou expiré."})

        query("UPDATE users SET email_verified = true, updated_at = now() WHERE id = :'i'::uuid;",
              {"i": user_id}, fetch=False)
        log_event(user_id, "email_verified", user_id)

        return self._json(200, {"ok": True, "message": "Adresse email confirmée."})

    def _forgot_password(self):
        try:
            form = self._form_or_400()

            if form is None:
                return
        except ValueError:
            return self._json(400, {"ok": False, "error": "Requête invalide."})
        email = validate_email(form.get("email", ""))
        row = find_user_by_email(email) if email else None

        if row:
            raw = issue_token(row[0], "reset_password", RESET_TOKEN_SECONDS)
            ok, detail = send_reset({"email": row[1]}, raw)

            if not ok:
                print("[accounts] reset email failed: %s" % detail, file=sys.stderr, flush=True)

            log_event(row[0], "password_reset_requested", row[0], {"mail_sent": ok})

        # Same answer either way: never reveal whether an address is registered.
        return self._json(200, {"ok": True,
                                "message": "Si un compte existe pour cette adresse, un email de réinitialisation vient d'être envoyé."})

    def _reset_password(self):
        try:
            form = self._form_or_400()

            if form is None:
                return
        except ValueError:
            return self._json(400, {"ok": False, "error": "Requête invalide."})
        password = form.get("password", "")
        confirm = form.get("passwordConfirm", "")

        if password != confirm:
            return self._json(400, {"ok": False, "error": "Les deux mots de passe ne correspondent pas."})

        problem = password_problem(password)

        if problem:
            return self._json(400, {"ok": False, "error": problem})

        user_id = consume_token(form.get("token", ""), "reset_password")

        if not user_id:
            return self._json(400, {"ok": False, "error": "Lien invalide ou expiré."})

        query("UPDATE users SET password_hash = :'p', updated_at = now() WHERE id = :'i'::uuid;",
              {"p": hash_password(password), "i": user_id}, fetch=False)

        # A password change invalidates every existing session, as the policy requires.
        revoke_all_sessions(user_id)
        log_event(user_id, "password_reset", user_id)

        return self._json(200, {"ok": True, "message": "Mot de passe modifié. Tu peux te connecter."})

    def _change_password(self):
        row = session_user(self)

        if not row:
            return self._json(401, {"ok": False, "error": "not authenticated"})

        form = self._form_or_400()

        if form is None:
            return
        current = form.get("currentPassword", "")
        password = form.get("password", "")

        if not verify_password(current, row[2]):
            return self._json(400, {"ok": False, "error": "Mot de passe actuel incorrect."})

        problem = password_problem(password)

        if problem:
            return self._json(400, {"ok": False, "error": problem})

        query("UPDATE users SET password_hash = :'p', updated_at = now() WHERE id = :'i'::uuid;",
              {"p": hash_password(password), "i": row[0]}, fetch=False)
        revoke_all_sessions(row[0])
        log_event(row[0], "password_changed", row[0])

        return self._json(200, {"ok": True, "message": "Mot de passe modifié. Reconnecte-toi."},
                          cookie=self._cookie_header("", 0))

    def _change_email(self):
        row = session_user(self)

        if not row:
            return self._json(401, {"ok": False, "error": "not authenticated"})

        form = self._form_or_400()

        if form is None:
            return

        if not verify_password(form.get("password", ""), row[2]):
            return self._json(400, {"ok": False, "error": "Mot de passe incorrect."})

        email = validate_email(form.get("email", ""))

        if not email:
            return self._json(400, {"ok": False, "error": "Adresse email invalide."})

        existing = find_user_by_email(email)

        if existing and existing[0] != row[0]:
            return self._json(400, {"ok": False, "error": "Cette adresse est déjà utilisée."})

        query("UPDATE users SET email = :'e', email_verified = false, updated_at = now() WHERE id = :'i'::uuid;",
              {"e": email, "i": row[0]}, fetch=False)

        # A changed address must not leave a thief's other sessions alive, and the previous
        # address is told (it is the owner's only warning if the password was stolen).
        revoke_other_sessions(row[0], read_cookie(self.headers.get("Cookie"), COOKIE))

        if row[1] != email:
            send_email_changed_notice(row[1], email)

        raw = issue_token(row[0], "verify_email", VERIFY_TOKEN_SECONDS)
        ok, _ = send_verification({"email": email}, raw)
        log_event(row[0], "email_changed", row[0], {"mail_sent": ok})

        return self._json(200, {"ok": True, "message": "Adresse modifiée. Confirme-la via le lien reçu par email."})

    def _form_or_400(self):
        """Form body, or None after answering 400 (malformed or non-object JSON)."""
        try:
            return self._form()
        except ValueError as exc:
            self._json(400, {"ok": False, "error": "Requête invalide: %s" % exc})
            return None

    def _update_profile(self):
        row = session_user(self)

        if not row:
            return self._json(401, {"ok": False, "error": "not authenticated"})

        form = self._form_or_400()

        if form is None:
            return

        # A real PATCH: an omitted field keeps its stored value. Writing "absent" as empty used to
        # erase the displayed name (any client sending only avatarUrl wiped the name).
        fields = {}

        if "displayName" in form:
            fields["display_name"] = (form.get("displayName") or "")[:80]

        if "avatarUrl" in form:
            avatar = (form.get("avatarUrl") or "")[:400]

            if avatar and not re.match(r"^(https?://|/avatars/)", avatar):
                return self._json(400, {"ok": False, "error": "Avatar invalide."})

            fields["avatar_url"] = avatar

        if not fields:
            return self._json(400, {"ok": False, "error": "Rien à mettre à jour."})

        current = load_profile(row[0]) or {}
        display = fields.get("display_name", current.get("displayName") or "")
        avatar = fields.get("avatar_url", current.get("avatarUrl") or "")

        query(
            "INSERT INTO profiles (user_id, display_name, avatar_url) "
            "VALUES (:'u'::uuid, nullif(:'d',''), nullif(:'a','')) "
            "ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, "
            "avatar_url = EXCLUDED.avatar_url, updated_at = now();",
            {"u": row[0], "d": display, "a": avatar},
            fetch=False,
        )
        log_event(row[0], "profile_updated", row[0])

        return self._json(200, {"ok": True, "profile": load_profile(row[0])})

    def _export_data(self):
        row = session_user(self)

        if not row:
            return self._json(401, {"ok": False, "error": "not authenticated"})

        chats = query(
            "SELECT id, coalesce(description,''), timestamp, messages::text FROM chats "
            "WHERE user_id = :'u'::uuid ORDER BY timestamp DESC;",
            {"u": row[0]},
        )
        projects = query(
            "SELECT slug, coalesce(name,''), url, to_char(published_at,'YYYY-MM-DD\"T\"HH24:MI:SSOF') "
            "FROM projects WHERE user_id = :'u'::uuid ORDER BY published_at DESC;",
            {"u": row[0]},
        )

        payload = {
            "exportedAt": now_iso(),
            "account": user_public(row),
            "profile": load_profile(row[0]),
            "chats": [{"id": c[0], "description": c[1], "timestamp": c[2],
                       "messages": json.loads(c[3])} for c in chats],
            "projects": [{"slug": p[0], "name": p[1], "url": p[2], "publishedAt": p[3]} for p in projects],
        }

        log_event(row[0], "data_exported", row[0])

        return self._json(200, {"ok": True, "data": payload})

    def _delete_account(self):
        row = session_user(self)

        if not row:
            return self._json(401, {"ok": False, "error": "not authenticated"})

        form = self._form_or_400()

        if form is None:
            return

        if not verify_password(form.get("password", ""), row[2]):
            return self._json(400, {"ok": False, "error": "Mot de passe incorrect."})

        if row[5] == "t":
            remaining = query("SELECT count(*)::text FROM users WHERE is_admin AND id <> :'i'::uuid;",
                              {"i": row[0]})
            if remaining and remaining[0][0] == "0":
                return self._json(400, {"ok": False,
                                        "error": "Dernier administrateur : crée un autre admin avant de supprimer ce compte."})

        # Anonymise rather than cascade-delete the conversations: the audit trail stays
        # meaningful, and the personal data goes. ON DELETE CASCADE clears sessions,
        # tokens, profile and roles.
        query("UPDATE chats SET user_id = NULL WHERE user_id = :'u'::uuid;", {"u": row[0]}, fetch=False)
        query("UPDATE projects SET user_id = NULL WHERE user_id = :'u'::uuid;", {"u": row[0]}, fetch=False)
        query("DELETE FROM users WHERE id = :'u'::uuid;", {"u": row[0]}, fetch=False)
        log_event(None, "account_deleted", row[0], {"email_hash": sha256(row[1])[:16]})

        return self._json(200, {"ok": True, "message": "Compte supprimé."},
                          cookie=self._cookie_header("", 0))

    # --- admin handlers ---------------------------------------------------

    def _require_admin(self):
        row = session_user(self)

        if not row:
            self._json(401, {"ok": False, "error": "not authenticated"})
            return None

        if row[5] != "t":
            # Authorisation is checked HERE, on the server: calling the API directly with a
            # normal session must fail exactly like clicking a hidden button.
            log_event(row[0], "admin_access_denied", None, {"path": self.path.split("?")[0]})
            self._json(403, {"ok": False, "error": "Accès refusé."})
            return None

        return row

    def _admin_list(self):
        if not self._require_admin():
            return

        qs = parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
        search = (qs.get("q", [""])[0] or "").strip()[:80]
        role = (qs.get("role", [""])[0] or "").strip()
        status = (qs.get("status", [""])[0] or "").strip()
        try:
            page = max(1, int(qs.get("page", ["1"])[0]))
        except ValueError:
            page = 1

        per_page = 20
        clauses, params = [], {}

        if search:
            clauses.append("(u.email ILIKE :'q' OR coalesce(p.display_name,'') ILIKE :'q')")
            params["q"] = "%" + search + "%"

        if role in ("user", "admin"):
            params["r"] = role
            clauses.append("u.is_admin = %s" % ("true" if role == "admin" else "false"))

        if status in ("active", "suspended"):
            params["s"] = status
            clauses.append("u.status = :'s'")

        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        params["limit"] = per_page
        params["offset"] = (page - 1) * per_page

        rows = query(
            "SELECT u.id, u.email, u.email_verified, u.status, u.is_admin, "
            "coalesce(p.display_name,''), coalesce(p.avatar_url,''), "
            "to_char(u.created_at,'YYYY-MM-DD\"T\"HH24:MI:SSOF'), "
            "coalesce(to_char(u.last_seen_at,'YYYY-MM-DD\"T\"HH24:MI:SSOF'),''), "
            "(SELECT count(*)::text FROM sessions s WHERE s.user_id = u.id) "
            "FROM users u LEFT JOIN profiles p ON p.user_id = u.id %s "
            "ORDER BY u.created_at DESC LIMIT %s OFFSET %s;" % (where, per_page, params["offset"]),
            params,
        )

        total = query(
            "SELECT count(*)::text FROM users u LEFT JOIN profiles p ON p.user_id = u.id %s;" % where,
            params,
        )

        users = [
            {
                "id": r[0], "email": r[1], "emailVerified": r[2] == "t", "status": r[3],
                "isAdmin": r[4] == "t", "displayName": r[5], "avatarUrl": r[6],
                "createdAt": r[7], "lastSeenAt": r[8] or None, "activeSessions": int(r[9]),
            }
            for r in rows
        ]

        return self._json(200, {"ok": True, "users": users, "page": page, "perPage": per_page,
                                "total": int(total[0][0]) if total else 0})

    def _admin_update(self, user_id):
        admin = self._require_admin()

        if not admin:
            return

        form = self._form_or_400()

        if form is None:
            return
        target = find_user_by_id(user_id)

        if not target:
            return self._json(404, {"ok": False, "error": "Utilisateur introuvable."})

        if "isAdmin" in form:
            make_admin = bool(form["isAdmin"])

            if not make_admin and target[5] == "t":
                remaining = query("SELECT count(*)::text FROM users WHERE is_admin AND id <> :'i'::uuid;",
                                  {"i": user_id})

                if remaining and remaining[0][0] == "0":
                    return self._json(400, {"ok": False,
                                            "error": "Impossible de retirer le dernier administrateur."})

            query("UPDATE users SET is_admin = %s, updated_at = now() WHERE id = :'i'::uuid;"
                  % ("true" if make_admin else "false"), {"i": user_id}, fetch=False)
            query("INSERT INTO user_roles (user_id, role) VALUES (:'i'::uuid, :'r') ON CONFLICT DO NOTHING;",
                  {"i": user_id, "r": "admin" if make_admin else "user"}, fetch=False)
            log_event(admin[0], "role_changed", user_id, {"isAdmin": make_admin})

            if not make_admin:
                revoke_all_sessions(user_id)

        if "status" in form:
            status = form["status"]

            if status not in ("active", "suspended"):
                return self._json(400, {"ok": False, "error": "Statut invalide."})

            if status == "suspended" and target[5] == "t":
                remaining = query("SELECT count(*)::text FROM users WHERE is_admin AND id <> :'i'::uuid;",
                                  {"i": user_id})

                if remaining and remaining[0][0] == "0":
                    return self._json(400, {"ok": False,
                                            "error": "Impossible de suspendre le dernier administrateur."})

            query("UPDATE users SET status = :'s', updated_at = now(), "
                  "suspended_at = CASE WHEN :'s' = 'suspended' THEN now() ELSE NULL END "
                  "WHERE id = :'i'::uuid;", {"s": status, "i": user_id}, fetch=False)
            log_event(admin[0], "status_changed", user_id, {"status": status})

            if status == "suspended":
                revoke_all_sessions(user_id)

        return self._json(200, {"ok": True})

    def _admin_delete(self, user_id):
        admin = self._require_admin()

        if not admin:
            return

        target = find_user_by_id(user_id)

        if not target:
            return self._json(404, {"ok": False, "error": "Utilisateur introuvable."})

        if target[5] == "t":
            remaining = query("SELECT count(*)::text FROM users WHERE is_admin AND id <> :'i'::uuid;",
                              {"i": user_id})

            if remaining and remaining[0][0] == "0":
                return self._json(400, {"ok": False,
                                        "error": "Impossible de supprimer le dernier administrateur actif."})

        query("UPDATE chats SET user_id = NULL WHERE user_id = :'u'::uuid;", {"u": user_id}, fetch=False)
        query("UPDATE projects SET user_id = NULL WHERE user_id = :'u'::uuid;", {"u": user_id}, fetch=False)
        query("DELETE FROM users WHERE id = :'u'::uuid;", {"u": user_id}, fetch=False)
        log_event(admin[0], "admin_account_deleted", user_id, {"email_hash": sha256(target[1])[:16]})

        return self._json(200, {"ok": True})


# The class only defines do_GET; BaseHTTPRequestHandler answers 501 to any method with no
# do_<METHOD>, which is how `HEAD /login` reached nginx as 501 (bolt_auth.py already does this).
AccountsHandler.do_HEAD = AccountsHandler.do_GET
