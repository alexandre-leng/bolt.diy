#!/usr/bin/env python3
"""Post-login redirect target: same-site paths only."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ui.routes import safe_redirect_target  # noqa: E402


class SafeRedirectTest(unittest.TestCase):
    def test_keeps_same_site_paths(self):
        self.assertEqual(safe_redirect_target("/dashboard"), "/dashboard")
        self.assertEqual(safe_redirect_target("/chat/2-1792164125491-0"), "/chat/2-1792164125491-0")
        self.assertEqual(safe_redirect_target("/settings/security?tab=2"), "/settings/security?tab=2")
        self.assertEqual(safe_redirect_target(None), "/dashboard")
        self.assertEqual(safe_redirect_target(""), "/dashboard")

    def test_rejects_cross_origin_targets(self):
        for target in (
            "//evil.com",
            "/\\evil.com",
            "https://evil.com/x",
            "http://evil.com",
            "/\\/evil.com",
            "evil.com",
            "/chat\r\nX-Injected: 1",
            "  //evil.com  ",
            "\t//evil.com",
        ):
            self.assertEqual(safe_redirect_target(target), "/dashboard", target)

    def test_the_previous_guard_would_have_accepted_the_backslash_case(self):
        # Documented here so the fix is provable: the old rule
        # `not startswith("/") or startswith("//")` accepted the cross-origin target.
        target = "/\\evil.com"
        old_guard_accepts = not (not target.startswith("/") or target.startswith("//"))
        self.assertTrue(old_guard_accepts)
        self.assertEqual(safe_redirect_target(target), "/dashboard")

    def test_single_slash_is_not_rejected(self):
        self.assertEqual(safe_redirect_target("/"), "/")


if __name__ == "__main__":
    unittest.main()
