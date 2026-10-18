#!/usr/bin/env python3
"""Page routes for bolt-accounts.

Every route here re-checks the session on the server before rendering. A page is a convenience
over the API, never a substitute for its authorization.
"""

from __future__ import annotations

import json
import os
import re
import sys
from urllib.parse import parse_qs

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ui import pages  # noqa: E402


def safe_redirect_target(target: str | None) -> str:
    """Where a post-login redirect is allowed to go: a same-site path, or the dashboard.

    A guard of `startswith("/") and not startswith("//")` lets `/\\evil.com` through:
    browsers normalise the leading backslash into a slash, turning it into the
    protocol-relative URL `//evil.com` — a redirect to another origin right after login.
    """
    value = (target or "").strip()

    if not re.match(r"^/(?![/\\])", value):
        return "/dashboard"

    if "\\" in value or "\r" in value or "\n" in value:
        return "/dashboard"

    return value


class PageRoutes:
    """Mixin: adds HTML routes to AccountsHandler without bloating the API handler."""

    def _html(self, body: bytes, status: int = 200, cookie: str | None = None):
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cookie:
            self.send_header("Set-Cookie", cookie)

        try:
            self.end_headers()

            # HEAD must not carry a body: answering 501 was the service having no do_HEAD,
            # and sending the bytes would make proxies hang on the advertised length.
            if self.command != "HEAD":
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            return

    def _redirect(self, location: str, cookie: str | None = None):
        self.send_response(303)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _flash(self, kind: str, text: str) -> str:
        """One-shot message carried in the query string: no session state needed."""
        from urllib.parse import quote
        return "/%s/%s" % (kind, quote(text, safe=""))

    def _read_flash(self, query: str) -> tuple[str, str, str]:
        """Return (path, kind, message) from a `?m=...` or `?e=...` parameter."""
        qs = parse_qs(query or "")

        return (qs.get("m", [""])[0], qs.get("e", [""])[0], "")

    # --- public pages -----------------------------------------------------

    def html_home(self):
        """Landing: send signed-in users to their dashboard, everyone else to the login page.

        Bolt itself stays behind nginx's own auth_request, so this page is only ever the
        account entry point, never the app.
        """
        import handlers as h

        if h.session_user(self):
            return self._redirect("/dashboard")

        return self._redirect("/login")

    def html_logout(self):
        """GET /logout must end the session too: a stale link or a bookmark should not leave
        someone signed in."""
        import handlers as h

        raw = h.read_cookie(self.headers.get("Cookie"), h.COOKIE)

        if raw:
            h.query("DELETE FROM sessions WHERE token_hash = :'h';", {"h": h.sha256(raw)}, fetch=False)

        return self._redirect("/login", cookie=self._cookie_header("", 0))

    def html_register(self):
        import handlers as h

        if h.session_user(self):
            return self._redirect("/dashboard")

        qs = parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
        ok, err, _ = self._read_flash(self.path.split("?", 1)[1] if "?" in self.path else "")

        return self._html(pages.register_page(error=err, notice_text=ok))

    def html_login(self):
        import handlers as h

        if h.session_user(self):
            return self._redirect("/dashboard")

        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        qs = parse_qs(query)
        ok, err, _ = self._read_flash(query)
        next_path = qs.get("next", ["/"])[0]

        return self._html(pages.login_page(error=err, notice_text=ok, next_path=next_path))

    def html_forgot(self):
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        ok, err, _ = self._read_flash(query)

        return self._html(pages.forgot_page(error=err, notice_text=ok))

    def html_reset(self):
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        qs = parse_qs(query)
        ok, err, _ = self._read_flash(query)

        return self._html(pages.reset_page(qs.get("token", [""])[0], error=err, notice_text=ok))

    def html_verify_email(self):
        import handlers as h

        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        token = parse_qs(query).get("token", [""])[0]
        user_id = h.consume_token(token, "verify_email") if token else None

        if not user_id:
            return self._html(pages.verify_page(False, "Ce lien est invalide ou a expiré. Demande un nouvel email de confirmation."))

        h.query("UPDATE users SET email_verified = true, updated_at = now() WHERE id = :'i'::uuid;",
                {"i": user_id}, fetch=False)
        h.log_event(user_id, "email_verified", user_id)

        return self._html(pages.verify_page(True, "Ton adresse email est confirmée. Tu peux te connecter."))

    def html_policy(self, kind: str):
        if kind == "terms":
            body = """<h1>Conditions d'utilisation</h1>
<p class="sub">Version MVP.</p>
<p>Bolt est un outil de création et de publication de sites. En créant un compte, tu t'engages à ne
publier aucun contenu illicite et à ne pas tenter d'accéder aux données d'un autre utilisateur.</p>
<p>Les sites publiés sont accessibles publiquement via leur URL. Tu restes responsable de leur contenu.</p>
<p class="links"><a href="/register">Retour à l'inscription</a></p>"""
        else:
            body = """<h1>Politique de confidentialité</h1>
<p class="sub">Version MVP.</p>
<p>Nous stockons ton adresse email, un mot de passe haché (Argon2id, jamais en clair), ton nom
affiché, tes conversations, tes sites publiés et un journal des opérations sensibles.</p>
<p>Tu peux exporter l'ensemble de tes données ou supprimer ton compte depuis <a href="/settings/account">Mon compte</a>.</p>
<p class="links"><a href="/register">Retour à l'inscription</a></p>"""

        return self._html(pages.page(body, kind))

    # --- signed-in pages --------------------------------------------------

    def html_dashboard(self):
        import handlers as h

        row = h.session_user(self)

        if not row:
            return self._redirect("/login?next=/dashboard")

        user = h.user_public(row)
        user["profile"] = h.load_profile(user["id"])

        chats = h.query("SELECT count(*)::text FROM chats WHERE user_id = :'u'::uuid;", {"u": user["id"]})
        projects = h.query("SELECT count(*)::text FROM projects WHERE user_id = :'u'::uuid;", {"u": user["id"]})
        sessions = h.query("SELECT count(*)::text FROM sessions WHERE user_id = :'u'::uuid;", {"u": user["id"]})

        stats = {
            "Conversations": chats[0][0] if chats else "0",
            "Sites publiés": projects[0][0] if projects else "0",
            "Sessions actives": sessions[0][0] if sessions else "0",
            "Email vérifié": "oui" if user["emailVerified"] else "non",
        }

        return self._html(pages.dashboard_page(user, stats))

    def html_account(self):
        import handlers as h

        row = h.session_user(self)

        if not row:
            return self._redirect("/login?next=/settings/account")

        user = h.user_public(row)
        user["profile"] = h.load_profile(user["id"])
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        ok, err, _ = self._read_flash(query)

        return self._html(pages.account_page(user, message=ok, error=err))

    def html_security(self):
        import handlers as h

        row = h.session_user(self)

        if not row:
            return self._redirect("/login?next=/settings/security")

        user = h.user_public(row)
        user["profile"] = h.load_profile(user["id"])

        sessions = h.query(
            "SELECT coalesce(user_agent,''), coalesce(ip,''), to_char(last_seen_at,'YYYY-MM-DD\"T\"HH24:MI:SSOF') "
            "FROM sessions WHERE user_id = :'u'::uuid ORDER BY last_seen_at DESC LIMIT 10;",
            {"u": user["id"]},
        )
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        ok, err, _ = self._read_flash(query)

        return self._html(pages.security_page(user, sessions, message=ok, error=err))

    def html_admin_users(self):
        import handlers as h

        row = h.session_user(self)

        if not row:
            return self._redirect("/login?next=/admin/users")

        if row[5] != "t":
            h.log_event(row[0], "admin_page_denied", None)
            return self._html(pages.notice_page("Accès refusé",
                                                "Cette section est réservée aux administrateurs.", "Retour", "/dashboard"),
                              status=403)

        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        qs = parse_qs(query)
        ok, err, _ = self._read_flash(query)

        # Reuse the API's own list logic by calling it into a payload, so page and API can never
        # drift apart on filtering or pagination.
        payload = self._admin_list_payload(qs)

        return self._html(pages.admin_page(
            payload["users"], payload["page"], payload["total"], payload["perPage"],
            query_text=qs.get("q", [""])[0], role=qs.get("role", [""])[0],
            status=qs.get("status", [""])[0], message=ok, error=err,
        ))

    def _admin_list_payload(self, qs):
        import handlers as h

        search = (qs.get("q", [""])[0] or "").strip()[:80]
        role = (qs.get("role", [""])[0] or "").strip()
        status = (qs.get("status", [""])[0] or "").strip()

        try:
            page_no = max(1, int(qs.get("page", ["1"])[0]))
        except ValueError:
            page_no = 1

        per_page = 20
        clauses, params = [], {}

        if search:
            clauses.append("(u.email ILIKE :'q' OR coalesce(p.display_name,'') ILIKE :'q')")
            params["q"] = "%" + search + "%"

        if role == "admin":
            clauses.append("u.is_admin = true")
        elif role == "user":
            clauses.append("u.is_admin = false")

        if status in ("active", "suspended"):
            params["s"] = status
            clauses.append("u.status = :'s'")

        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        offset = (page_no - 1) * per_page

        rows = h.query(
            "SELECT u.id, u.email, u.email_verified, u.status, u.is_admin, "
            "coalesce(p.display_name,''), coalesce(p.avatar_url,''), "
            "to_char(u.created_at,'YYYY-MM-DD\"T\"HH24:MI:SSOF'), "
            "coalesce(to_char(u.last_seen_at,'YYYY-MM-DD\"T\"HH24:MI:SSOF'),''), "
            "(SELECT count(*)::text FROM sessions s WHERE s.user_id = u.id) "
            "FROM users u LEFT JOIN profiles p ON p.user_id = u.id %s "
            "ORDER BY u.created_at DESC LIMIT %d OFFSET %d;" % (where, per_page, offset),
            params,
        )
        total = h.query("SELECT count(*)::text FROM users u LEFT JOIN profiles p ON p.user_id = u.id %s;" % where, params)

        users = [
            {"id": r[0], "email": r[1], "emailVerified": r[2] == "t", "status": r[3],
             "isAdmin": r[4] == "t", "displayName": r[5], "avatarUrl": r[6],
             "createdAt": r[7], "lastSeenAt": r[8] or None, "activeSessions": int(r[9])}
            for r in rows
        ]

        return {"users": users, "page": page_no, "perPage": per_page,
                "total": int(total[0][0]) if total else 0}

    # --- form posts -------------------------------------------------------

    def html_post(self, path: str):
        """Handle the HTML form submissions. Each redirects (Post/Redirect/Get)."""
        import handlers as h

        form = self._form()

        if path == "/login":
            return self._html_login_post(form)

        if path == "/register":
            return self._html_register_post(form)

        if path == "/forgot-password":
            email = h.validate_email(form.get("email", ""))
            row = h.find_user_by_email(email) if email else None

            if row:
                raw = h.issue_token(row[0], "reset_password", h.RESET_TOKEN_SECONDS)
                h.send_reset({"email": row[1]}, raw)
                h.log_event(row[0], "password_reset_requested", row[0])

            return self._redirect("/forgot-password?m=" + self._q(
                "Si un compte existe pour cette adresse, un email de réinitialisation vient d'être envoyé."))

        if path == "/reset-password":
            token = form.get("token", "")
            password = form.get("password", "")

            if password != form.get("passwordConfirm", ""):
                return self._redirect("/reset-password?token=%s&e=%s" % (
                    self._q(token), self._q("Les deux mots de passe ne correspondent pas.")))

            problem = h.password_problem(password)

            if problem:
                return self._redirect("/reset-password?token=%s&e=%s" % (self._q(token), self._q(problem)))

            user_id = h.consume_token(token, "reset_password")

            if not user_id:
                return self._redirect("/forgot-password?e=" + self._q("Ce lien est invalide ou a expiré."))

            h.query("UPDATE users SET password_hash = :'p', updated_at = now() WHERE id = :'i'::uuid;",
                    {"p": h.hash_password(password), "i": user_id}, fetch=False)
            h.revoke_all_sessions(user_id)
            h.log_event(user_id, "password_reset", user_id)

            return self._redirect("/login?m=" + self._q("Mot de passe modifié. Tu peux te connecter."))

        # --- routes that need a session
        row = h.session_user(self)

        if not row:
            return self._redirect("/login")

        user = h.user_public(row)

        if path == "/settings/account/profile":
            return self._html_profile_post(row, form)

        if path == "/settings/account/email":
            if not h.verify_password(form.get("password", ""), row[2]):
                return self._redirect("/settings/account?e=" + self._q("Mot de passe incorrect."))

            email = h.validate_email(form.get("email", ""))

            if not email:
                return self._redirect("/settings/account?e=" + self._q("Adresse email invalide."))

            existing = h.find_user_by_email(email)

            if existing and existing[0] != row[0]:
                return self._redirect("/settings/account?e=" + self._q("Cette adresse est déjà utilisée."))

            h.query("UPDATE users SET email = :'e', email_verified = false, updated_at = now() WHERE id = :'i'::uuid;",
                    {"e": email, "i": row[0]}, fetch=False)
            # Same rule as the API: other sessions go, the previous address is told.
            h.revoke_other_sessions(row[0], h.read_cookie(self.headers.get("Cookie"), h.COOKIE))

            if row[1] != email:
                h.send_email_changed_notice(row[1], email)

            raw = h.issue_token(row[0], "verify_email", h.VERIFY_TOKEN_SECONDS)
            h.send_verification({"email": email}, raw)
            h.log_event(row[0], "email_changed", row[0])

            return self._redirect("/settings/account?m=" + self._q(
                "Adresse modifiée. Confirme-la via le lien reçu par email."))

        if path == "/settings/account/export":
            h.log_event(row[0], "data_exported", row[0])
            data = self._export_payload(row)
            body = json.dumps(data, ensure_ascii=False, indent=2).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="bolt-donnees.json"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

            return

        if path == "/settings/account/delete":
            if not h.verify_password(form.get("password", ""), row[2]) or not form.get("confirm"):
                return self._redirect("/settings/account?e=" + self._q(
                    "Mot de passe incorrect ou confirmation manquante."))

            if row[5] == "t":
                remaining = h.query("SELECT count(*)::text FROM users WHERE is_admin AND id <> :'i'::uuid;", {"i": row[0]})

                if remaining and remaining[0][0] == "0":
                    return self._redirect("/settings/account?e=" + self._q(
                        "Dernier administrateur : crée un autre admin avant de supprimer ce compte."))

            h.query("UPDATE chats SET user_id = NULL WHERE user_id = :'u'::uuid;", {"u": row[0]}, fetch=False)
            h.query("UPDATE projects SET user_id = NULL WHERE user_id = :'u'::uuid;", {"u": row[0]}, fetch=False)
            h.query("DELETE FROM users WHERE id = :'u'::uuid;", {"u": row[0]}, fetch=False)
            h.log_event(None, "account_deleted", row[0])

            return self._redirect("/login?m=" + self._q("Compte supprimé."),
                                  cookie=self._cookie_header("", 0))

        if path == "/settings/security/password":
            if not h.verify_password(form.get("currentPassword", ""), row[2]):
                return self._redirect("/settings/security?e=" + self._q("Mot de passe actuel incorrect."))

            password = form.get("newPassword", "")

            if password != form.get("passwordConfirm", ""):
                return self._redirect("/settings/security?e=" + self._q("Les deux mots de passe ne correspondent pas."))

            problem = h.password_problem(password)

            if problem:
                return self._redirect("/settings/security?e=" + self._q(problem))

            h.query("UPDATE users SET password_hash = :'p', updated_at = now() WHERE id = :'i'::uuid;",
                    {"p": h.hash_password(password), "i": row[0]}, fetch=False)
            h.revoke_all_sessions(row[0])
            h.log_event(row[0], "password_changed", row[0])

            return self._redirect("/login?m=" + self._q("Mot de passe modifié. Reconnecte-toi."),
                                  cookie=self._cookie_header("", 0))

        if path == "/settings/security/logout-all":
            h.query("DELETE FROM sessions WHERE user_id = :'u'::uuid;", {"u": row[0]}, fetch=False)
            h.log_event(row[0], "sessions_revoked", row[0])

            return self._redirect("/login?m=" + self._q("Toutes les sessions ont été déconnectées."),
                                  cookie=self._cookie_header("", 0))

        # --- admin form posts
        if path.startswith("/admin/users/"):
            if row[5] != "t":
                h.log_event(row[0], "admin_access_denied", None, {"path": path})
                return self._redirect("/dashboard?e=" + self._q("Accès refusé."))

            return self._html_admin_post(path, form, row)

        if path == "/logout":
            raw = h.read_cookie(self.headers.get("Cookie"), h.COOKIE)

            if raw:
                h.query("DELETE FROM sessions WHERE token_hash = :'h';", {"h": h.sha256(raw)}, fetch=False)

            return self._redirect("/login", cookie=self._cookie_header("", 0))

        return self._redirect("/")

    def _html_login_post(self, form):
        import handlers as h

        email = h.validate_email(form.get("email", ""))
        password = form.get("password", "")
        ip = h.client_ip(self)
        target = safe_redirect_target(form.get("next"))

        if h._blocked(ip):
            return self._redirect("/login?e=" + self._q("Trop de tentatives. Réessaie dans 15 minutes."))

        row = h.find_user_by_email(email) if email else None
        # A parseable hash, so an unknown address costs a full Argon2 verification too.
        stored = row[2] if row else h.DUMMY_HASH
        # Verified BEFORE testing `row`: `not row or verify(...)` short-circuited, so an
        # unknown address skipped Argon2 entirely and answered measurably faster.
        password_ok = h.verify_password(password, stored)

        if not row or not password_ok:
            h._note_failure(ip)
            h.log_event(None, "login_failed", None, {"ip": ip})

            return self._redirect("/login?e=" + self._q("Email ou mot de passe incorrect."))

        if row[4] != "active":
            return self._redirect("/login?e=" + self._q("Ce compte est suspendu."))

        h._clear_failures(ip)
        h.query("UPDATE users SET last_seen_at = now() WHERE id = :'i'::uuid;", {"i": row[0]}, fetch=False)
        h.drop_presented_session(self)
        token = h.create_session(row[0], self.headers.get("User-Agent", ""), ip)
        h.log_event(row[0], "login", row[0], {"ip": ip})

        return self._redirect(target, cookie=self._cookie_header(token, h.SESSION_SECONDS))

    def _html_register_post(self, form):
        import handlers as h

        email = h.validate_email(form.get("email", ""))
        password = form.get("password", "")

        def fail(message):
            return self._redirect("/register?e=" + self._q(message))

        if not email:
            return fail("Adresse email invalide.")

        if password != form.get("passwordConfirm", ""):
            return fail("Les deux mots de passe ne correspondent pas.")

        problem = h.password_problem(password)

        if problem:
            return fail(problem)

        if not form.get("acceptTerms") or not form.get("acceptPrivacy"):
            return fail("Tu dois accepter les conditions d'utilisation et la politique de confidentialité.")

        existing = h.find_user_by_email(email)

        if existing:
            # Same wording as success: never confirm whether an address is registered. Same
            # work too (hash + mail), so the response time does not tell either.
            h.hash_password(password)
            h.send_existing_account_notice(existing[1])

            return self._redirect("/login?m=" + self._q(
                "Si cette adresse peut être utilisée, un email de confirmation vient d'être envoyé."))

        rows = h.query("INSERT INTO users (email, password_hash) VALUES (:'e', :'p') RETURNING id;",
                       {"e": email, "p": h.hash_password(password)})
        user_id = rows[0][0]
        display = (form.get("displayName") or "").strip()[:80]

        h.query("INSERT INTO profiles (user_id, display_name) VALUES (:'u'::uuid, nullif(:'d','')) "
                "ON CONFLICT (user_id) DO NOTHING;",
                {"u": user_id, "d": display or email.split("@")[0]}, fetch=False)
        h.query("INSERT INTO user_roles (user_id, role) VALUES (:'u'::uuid, 'user') ON CONFLICT DO NOTHING;",
                {"u": user_id}, fetch=False)

        raw = h.issue_token(user_id, "verify_email", h.VERIFY_TOKEN_SECONDS)
        ok, _ = h.send_verification({"email": email}, raw)
        h.log_event(user_id, "register", user_id, {"mail_sent": ok})

        return self._redirect("/login?m=" + self._q(
            "Compte créé. Vérifie ta boîte email pour confirmer ton adresse."))

    def _html_profile_post(self, row, form):
        import handlers as h

        display = (form.get("displayName") or "").strip()[:80]
        avatar = (form.get("avatarUrl") or "").strip()[:400]

        if avatar and not (avatar.startswith("http://") or avatar.startswith("https://") or avatar.startswith("/avatars/")):
            return self._redirect("/settings/account?e=" + self._q("Avatar invalide : utilise une URL http(s)."))

        h.query(
            "INSERT INTO profiles (user_id, display_name, avatar_url) "
            "VALUES (:'u'::uuid, nullif(:'d',''), nullif(:'a','')) "
            "ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, "
            "avatar_url = EXCLUDED.avatar_url, updated_at = now();",
            {"u": row[0], "d": display, "a": avatar}, fetch=False)
        h.log_event(row[0], "profile_updated", row[0])

        return self._redirect("/settings/account?m=" + self._q("Profil enregistré."))

    def _html_admin_post(self, path, form, admin_row):
        import handlers as h

        target_id = form.get("id", "")

        if not h.UUID_RE.match(target_id):
            return self._redirect("/admin/users?e=" + self._q("Identifiant invalide."))

        target = h.find_user_by_id(target_id)

        if not target:
            return self._redirect("/admin/users?e=" + self._q("Utilisateur introuvable."))

        action = path.rsplit("/", 1)[-1]

        if action == "role":
            make_admin = form.get("isAdmin") == "1"

            if not make_admin and target[5] == "t":
                remaining = h.query("SELECT count(*)::text FROM users WHERE is_admin AND id <> :'i'::uuid;", {"i": target_id})

                if remaining and remaining[0][0] == "0":
                    return self._redirect("/admin/users?e=" + self._q("Impossible de retirer le dernier administrateur."))

            h.query("UPDATE users SET is_admin = %s, updated_at = now() WHERE id = :'i'::uuid;"
                    % ("true" if make_admin else "false"), {"i": target_id}, fetch=False)
            h.query("INSERT INTO user_roles (user_id, role) VALUES (:'i'::uuid, :'r') ON CONFLICT DO NOTHING;",
                    {"i": target_id, "r": "admin" if make_admin else "user"}, fetch=False)
            h.log_event(admin_row[0], "role_changed", target_id, {"isAdmin": make_admin})

            if not make_admin:
                h.revoke_all_sessions(target_id)

            return self._redirect("/admin/users?m=" + self._q("Rôle mis à jour."))

        if action == "status":
            status = form.get("status", "")

            if status not in ("active", "suspended"):
                return self._redirect("/admin/users?e=" + self._q("Statut invalide."))

            if status == "suspended" and target[5] == "t":
                remaining = h.query("SELECT count(*)::text FROM users WHERE is_admin AND id <> :'i'::uuid;", {"i": target_id})

                if remaining and remaining[0][0] == "0":
                    return self._redirect("/admin/users?e=" + self._q("Impossible de suspendre le dernier administrateur."))

            h.query("UPDATE users SET status = :'s', updated_at = now(), "
                    "suspended_at = CASE WHEN :'s' = 'suspended' THEN now() ELSE NULL END "
                    "WHERE id = :'i'::uuid;", {"s": status, "i": target_id}, fetch=False)
            h.log_event(admin_row[0], "status_changed", target_id, {"status": status})

            if status == "suspended":
                h.revoke_all_sessions(target_id)

            return self._redirect("/admin/users?m=" + self._q("Statut mis à jour."))

        if action == "reset":
            raw = h.issue_token(target_id, "reset_password", h.RESET_TOKEN_SECONDS)
            ok, _ = h.send_reset({"email": target[1]}, raw)
            h.log_event(admin_row[0], "admin_reset_sent", target_id, {"mail_sent": ok})

            return self._redirect("/admin/users?m=" + self._q(
                "Email de réinitialisation envoyé." if ok else "L'envoi de l'email a échoué."))

        if action == "delete":
            if target[5] == "t":
                remaining = h.query("SELECT count(*)::text FROM users WHERE is_admin AND id <> :'i'::uuid;", {"i": target_id})

                if remaining and remaining[0][0] == "0":
                    return self._redirect("/admin/users?e=" + self._q(
                        "Impossible de supprimer le dernier administrateur actif."))

            h.query("UPDATE chats SET user_id = NULL WHERE user_id = :'u'::uuid;", {"u": target_id}, fetch=False)
            h.query("UPDATE projects SET user_id = NULL WHERE user_id = :'u'::uuid;", {"u": target_id}, fetch=False)
            h.query("DELETE FROM users WHERE id = :'u'::uuid;", {"u": target_id}, fetch=False)
            h.log_event(admin_row[0], "admin_account_deleted", target_id)

            return self._redirect("/admin/users?m=" + self._q("Compte supprimé."))

        return self._redirect("/admin/users")

    def _export_payload(self, row):
        import handlers as h

        user = h.user_public(row)
        chats = h.query("SELECT id, coalesce(description,''), timestamp, messages::text FROM chats "
                        "WHERE user_id = :'u'::uuid ORDER BY timestamp DESC;", {"u": row[0]})
        projects = h.query("SELECT slug, coalesce(name,''), url, to_char(published_at,'YYYY-MM-DD\"T\"HH24:MI:SSOF') "
                           "FROM projects WHERE user_id = :'u'::uuid ORDER BY published_at DESC;", {"u": row[0]})

        return {
            "exportedAt": h.now_iso(),
            "account": user,
            "profile": h.load_profile(row[0]),
            "chats": [{"id": c[0], "description": c[1], "timestamp": c[2], "messages": json.loads(c[3])} for c in chats],
            "projects": [{"slug": p[0], "name": p[1], "url": p[2], "publishedAt": p[3]} for p in projects],
        }

    @staticmethod
    def _q(text: str) -> str:
        from urllib.parse import quote
        return quote(text, safe="")
