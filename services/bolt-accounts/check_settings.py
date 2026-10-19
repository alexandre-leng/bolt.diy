"""Signed-in check of /settings after adding the missing route.

Logs in for real, then requests each signed-in page and reports the status plus a
snippet of the rendered body, so a 200 with an error page cannot pass as success.
"""
import urllib.request
import urllib.error
import urllib.parse
import http.cookiejar
import pathlib

BASE = "https://bolt.169-58-18-46.sslip.io"
EMAIL = "alexandre@lengereau.fr"
PW = pathlib.Path("/opt/bolt/.bolt_password").read_text().strip()
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) bolt-settings-check/1.0"}

cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

body = urllib.parse.urlencode({"email": EMAIL, "password": PW}).encode()
req = urllib.request.Request(BASE + "/api/auth/login", data=body,
                             headers={**UA, "Content-Type": "application/x-www-form-urlencoded"})
with op.open(req, timeout=30) as r:
    print("login ->", r.status, "| cookies:", [c.name for c in cj])

print()
for path in ["/settings", "/settings/account", "/settings/security", "/dashboard", "/admin/users"]:
    try:
        with op.open(urllib.request.Request(BASE + path, headers=UA), timeout=30) as r:
            html = r.read().decode(errors="replace")
            # Pull the first heading so a 200 with an error page is visible.
            import re
            h = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.S | re.I)
            title = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
            print(f"{path:22} {r.status}  <title>={title.group(1).strip() if title else '?'}")
            print(f"{'':22} h1={h.group(1).strip()[:70] if h else '(none)'}")
    except urllib.error.HTTPError as e:
        print(f"{path:22} {e.code}  ERROR: {e.read()[:100].decode(errors='replace')}")
