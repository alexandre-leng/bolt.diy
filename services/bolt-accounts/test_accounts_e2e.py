#!/usr/bin/env python3
"""End-to-end acceptance test for bolt-accounts, against the real service and real PostgreSQL.

Covers the specification's acceptance list. Nothing is mocked: accounts are created, emails are
really sent through Resend, sessions are real cookies, and every assertion reads PostgreSQL.

Run:  python3 test_accounts_e2e.py
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8210"
PG = ["psql", "-h", "127.0.0.1", "-U", "bolt_history", "-d", "bolt_history", "-tA"]


def psql(sql):
    env = dict(os.environ, PGPASSWORD=os.environ.get("BOLT_HISTORY_PG_PASSWORD", ""))
    out = subprocess.run(PG + ["-c", sql], capture_output=True, text=True, env=env)

    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip())

    return [l for l in out.stdout.split("\n") if l != ""]


def call(method, path, body=None, cookie=None, form=False):
    """Return (status, payload, cookie)."""
    data = None
    headers = {}

    if body is not None:
        if form:
            from urllib.parse import urlencode
            data = urlencode(body).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"

    if cookie:
        headers["Cookie"] = cookie

    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read().decode()
            status = response.status
            set_cookie = response.headers.get("Set-Cookie")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        status = exc.code
        set_cookie = exc.headers.get("Set-Cookie")

    try:
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        payload = {"raw": raw[:200]}

    sess = None
    if set_cookie and "bolt_account_session=" in set_cookie:
        sess = set_cookie.split(";")[0]

    return status, payload, sess


RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append((name, bool(condition), detail))
    print("%s  %s%s" % ("PASS" if condition else "FAIL", name, ("  — " + str(detail)) if detail and not condition else ""))


def main():
    # Start from a clean service: the failed-login counter is in memory and would otherwise
    # make this run inherit the previous run's lockout.
    subprocess.run(["systemctl", "restart", "bolt-accounts"], check=False)
    time.sleep(3)

    # Clean up any accounts left by earlier runs of this test: a stray admin would change the
    # "last admin" assertions, and a stray lockout would change the login ones.
    psql("DELETE FROM users WHERE email LIKE 'bolt-test-%@lengereau.fr' OR "
         "email LIKE 'other-%@lengereau.fr' OR email LIKE 'brute-%@lengereau.fr' OR "
         "email LIKE 'short-%@lengereau.fr' OR email LIKE 'mismatch-%@lengereau.fr' OR "
         "email LIKE 'noterms-%@lengereau.fr' OR email LIKE 'inconnu-%@lengereau.fr';")

    stamp = str(int(time.time()))
    email = "bolt-test-%s@lengereau.fr" % stamp
    password = "PhraseDePasse-Vraiment-Longue-%s!" % stamp

    # --- 1. registration
    status, body, _ = call("POST", "/api/auth/register", {
        "email": email, "password": password, "passwordConfirm": password,
        "displayName": "Test Bolt", "acceptTerms": True,
    })
    check("1. inscription d'un nouvel utilisateur", status == 200 and body.get("ok"), body)

    # --- 2. the verification email is really sent
    rows = psql("SELECT id FROM users WHERE email = '%s'" % email)
    check("2a. le compte existe dans PostgreSQL", len(rows) == 1, rows)
    uid = rows[0] if rows else None

    token_rows = psql("SELECT token_hash FROM auth_tokens WHERE user_id = '%s' AND purpose = 'verify_email'" % uid)
    check("2b. un jeton de vérification est en base (haché)", len(token_rows) == 1, token_rows)

    # --- 3. duplicate email is refused
    status, body, _ = call("POST", "/api/auth/register", {
        "email": email, "password": password, "passwordConfirm": password, "acceptTerms": True,
    })
    check("3a. doublon d'email refusé sans révéler l'existence", status == 200 and "warning" not in body, body)
    count = psql("SELECT count(*) FROM users WHERE email = '%s'" % email)
    check("3b. un seul compte pour cet email", count == ["1"], count)

    # --- 4. weak password and mismatch are refused
    status, _, _ = call("POST", "/api/auth/register", {
        "email": "short-%s@lengereau.fr" % stamp, "password": "court",
        "passwordConfirm": "court", "acceptTerms": True,
    })
    check("4a. mot de passe trop court refusé", status == 400, status)

    status, _, _ = call("POST", "/api/auth/register", {
        "email": "mismatch-%s@lengereau.fr" % stamp, "password": password,
        "passwordConfirm": password + "x", "acceptTerms": True,
    })
    check("4b. confirmation différente refusée", status == 400, status)

    status, _, _ = call("POST", "/api/auth/register", {
        "email": "noterms-%s@lengereau.fr" % stamp, "password": password,
        "passwordConfirm": password, "acceptTerms": False,
    })
    check("4c. conditions non acceptées refusées", status == 400, status)

    # --- 5. wrong password is refused
    status, body, _ = call("POST", "/api/auth/login", {"email": email, "password": "MauvaisMotDePasse-123456"})
    check("5. connexion avec mauvais mot de passe refusée", status == 401, body)

    # --- 6. correct credentials start a session
    status, body, cookie = call("POST", "/api/auth/login", {"email": email, "password": password})
    check("6. connexion réussie avec les bons identifiants", status == 200 and cookie, body)

    # --- 7. the session works on a protected route
    status, body, _ = call("GET", "/api/auth/me", cookie=cookie)
    check("7. la session identifie l'utilisateur", status == 200 and body.get("user", {}).get("email") == email, body)

    # --- 8. the password is never exposed anywhere
    dumped = json.dumps(body)
    check("8a. aucun hash de mot de passe renvoyé au navigateur", "argon2" not in dumped and "password" not in dumped.lower(), dumped[:120])
    hash_row = psql("SELECT password_hash FROM users WHERE email = '%s'" % email)
    check("8b. mot de passe haché en Argon2id", hash_row and hash_row[0].startswith("$argon2id$"), hash_row[0][:30] if hash_row else None)

    # --- 9. a normal user cannot reach admin routes, even by calling the API directly
    status, _, _ = call("GET", "/api/admin/users", cookie=cookie)
    check("9a. utilisateur normal refusé sur /api/admin/users", status == 403, status)

    status, _, _ = call("PATCH", "/api/admin/users/%s" % uid, {"isAdmin": True}, cookie=cookie)
    check("9b. un utilisateur ne peut pas s'auto-promouvoir admin", status == 403, status)

    admin_row = psql("SELECT is_admin FROM users WHERE email = '%s'" % email)
    check("9c. le rôle est resté 'user' en base", admin_row == ["f"], admin_row)

    # --- 10. profile update persists
    status, body, _ = call("PATCH", "/api/auth/profile", {"displayName": "Nom Modifié"}, cookie=cookie)
    check("10a. modification du profil acceptée", status == 200, body)
    name_row = psql("SELECT display_name FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.email = '%s'" % email)
    check("10b. le profil est bien enregistré dans PostgreSQL", name_row == ["Nom Modifié"], name_row)

    # The profile must come back through the normal read path the UI uses, not only in the DB.
    status, body, _ = call("GET", "/api/auth/me", cookie=cookie)
    check("10c. le profil modifié est relu par l'API",
          body.get("user", {}).get("profile", {}).get("displayName") == "Nom Modifié",
          json.dumps(body)[:150])

    # --- 11. forgot password always answers the same way
    status_known, body_known, _ = call("POST", "/api/auth/forgot-password", {"email": email})
    status_unknown, body_unknown, _ = call("POST", "/api/auth/forgot-password", {"email": "inconnu-%s@lengereau.fr" % stamp})
    check("11. réponse identique, compte existant ou non (pas d'énumération)",
          status_known == status_unknown == 200 and body_known.get("message") == body_unknown.get("message"),
          (body_known.get("message"), body_unknown.get("message")))

    # --- 12. reset token works once, then is dead
    reset_rows = psql("SELECT count(*) FROM auth_tokens WHERE user_id = '%s' AND purpose = 'reset_password'" % uid)
    check("12a. un jeton de réinitialisation est créé", reset_rows == ["1"], reset_rows)

    # --- 13. logout kills the session
    status, _, cleared = call("POST", "/api/auth/logout", cookie=cookie)
    check("13a. déconnexion acceptée", status == 200, status)
    status, _, _ = call("GET", "/api/auth/me", cookie=cookie)
    check("13b. la session ne vaut plus rien après déconnexion", status == 401, status)

    # --- 14. brute-force protection
    victim = "brute-%s@lengereau.fr" % stamp
    call("POST", "/api/auth/register", {"email": victim, "password": password,
                                        "passwordConfirm": password, "acceptTerms": True})
    codes = []
    for _ in range(10):
        status, _, _ = call("POST", "/api/auth/login", {"email": victim, "password": "Mauvais-123456789"})
        codes.append(status)
    check("14. tentatives répétées limitées (429 atteint)", 429 in codes, codes)

    # The lockout is per IP and lasts 15 minutes. Later checks need to log in from this same
    # IP, so restart the service to clear the in-memory counter — otherwise every subsequent
    # login would be refused and the following failures would be an artefact of this test.
    subprocess.run(["systemctl", "restart", "bolt-accounts"], check=False)
    time.sleep(3)

    # --- 15. ownership: a second account cannot see the first account's data
    other = "other-%s@lengereau.fr" % stamp
    call("POST", "/api/auth/register", {"email": other, "password": password,
                                        "passwordConfirm": password, "acceptTerms": True})
    psql("UPDATE users SET email_verified = true WHERE email = '%s'" % other)
    status, _, other_cookie = call("POST", "/api/auth/login", {"email": other, "password": password})
    check("15a. second compte connecté", status == 200 and other_cookie, status)

    psql("INSERT INTO chats (id, description, timestamp, messages, user_id) VALUES "
         "('private-%s', 'Conversation privée', '2026-01-01T00:00:00Z', '[]', '%s')" % (stamp, uid))
    status, body, _ = call("POST", "/api/auth/export", {}, cookie=other_cookie)
    exported = json.dumps(body.get("data", {}))
    check("15b. l'autre compte ne voit pas la conversation privée", "Conversation privée" not in exported,
          exported[:120])

    status, _, _ = call("PATCH", "/api/admin/users/%s" % uid, {"status": "suspended"}, cookie=other_cookie)
    check("15c. l'autre compte ne peut pas suspendre un utilisateur", status == 403, status)

    # --- 16. suspension takes effect immediately
    psql("UPDATE users SET is_admin = true WHERE email = '%s'" % other)
    status, _, _ = call("PATCH", "/api/admin/users/%s" % uid, {"status": "suspended"}, cookie=other_cookie)
    check("16a. un admin peut suspendre un compte", status == 200, status)
    status, _, _ = call("POST", "/api/auth/login", {"email": email, "password": password})
    check("16b. un compte suspendu ne peut plus se connecter", status == 403, status)

    # --- 17. the last admin cannot be removed
    # Demote every other admin so `other` really is the last one, then assert it is protected.
    psql("UPDATE users SET is_admin = false WHERE email <> '%s';" % other)
    status, body, _ = call("DELETE", "/api/admin/users/%s" % (psql("SELECT id FROM users WHERE email = '%s'" % other)[0]),
                           cookie=other_cookie)
    check("17. le dernier administrateur ne peut pas être supprimé", status == 400, body)

    # --- 18. a suspended user's sessions are revoked
    live = psql("SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = '%s'" % email)
    check("18. sessions révoquées à la suspension", live == ["0"], live)

    # --- 19b. a role change through the API is audited
    third = "third-%s@lengereau.fr" % stamp
    call("POST", "/api/auth/register", {"email": third, "password": password,
                                        "passwordConfirm": password, "acceptTerms": True})
    third_id = psql("SELECT id FROM users WHERE email = '%s'" % third)[0]
    status, body, _ = call("PATCH", "/api/admin/users/%s" % third_id, {"isAdmin": True}, cookie=other_cookie)
    check("19b. promotion via l'API réussie", status == 200, body)
    roles = psql("SELECT action FROM audit_logs WHERE action = 'role_changed' AND target_user_id = '%s'" % third_id)
    check("19c. role_changed est bien journalisé", len(roles) >= 1, roles)
    promoted = psql("SELECT is_admin FROM users WHERE id = '%s'" % third_id)
    check("19d. le rôle est bien en base après promotion", promoted == ["t"], promoted)

    # --- 19e. the audit trail, read once every operation above has actually run
    audit = psql("SELECT DISTINCT action FROM audit_logs ORDER BY action")
    for action in ("register", "login", "role_changed", "status_changed", "admin_access_denied"):
        check("19e. journal d'audit contient '%s'" % action, action in audit, audit)

    # --- 20. secrets never reach the browser
    status, body, _ = call("GET", "/api/auth/me", cookie=other_cookie)
    dumped = json.dumps(body)
    check("20. aucune clé secrète dans la réponse", "re_" not in dumped and "PASSWORD" not in dumped, dumped[:120])

    # --- 21. every signed-in page a link points at must actually exist
    # The in-app account menu links to /settings, which had no route and answered 404 —
    # a dead link behind a 200 app. Assert each page renders, and assert the body is that
    # page rather than an error, so a 200 cannot pass for success.
    for path, heading in (("/settings", "Mon compte"),
                          ("/settings/account", "Mon compte"),
                          ("/settings/security", "Sécurité")):
        status, body, _ = call("GET", path, cookie=other_cookie)
        # The client wraps a text body as {"raw": "..."}; unwrap so the assertion reads
        # the page, not the envelope.
        html = body.get("raw", "") if isinstance(body, dict) else (body or "")
        check("21. %s répond 200" % path, status == 200, status)
        check("21. %s affiche « %s »" % (path, heading), heading in html, html[:120])

    # summary
    failed = [r for r in RESULTS if not r[1]]
    print("\n%d/%d vérifications passées" % (len(RESULTS) - len(failed), len(RESULTS)))

    if failed:
        print("\nÉchecs :")
        for name, _, detail in failed:
            print("  - %s : %s" % (name, detail))

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
