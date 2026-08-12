from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ScannerSecurityTests(unittest.TestCase):
    def test_content_security_policy_blocks_injection_primitives(self) -> None:
        html = (ROOT / "index.html").read_text(encoding="utf-8")

        for directive in (
            "base-uri 'none'",
            "object-src 'none'",
            "script-src-attr 'none'",
            "style-src-attr 'none'",
        ):
            self.assertIn(directive, html)

    def test_third_party_libraries_are_versioned_and_integrity_pinned(self) -> None:
        app = (ROOT / "app.js").read_text(encoding="utf-8")
        ocr = (ROOT / "ocr.js").read_text(encoding="utf-8")

        self.assertIn("@zxing/browser@0.2.1", app)
        self.assertIn(
            "sha384-HRtzk9lZgkbSgvUyQrnfC/GxiXZgwaNyD7hC9wcXlsBpDhkS80ISl73juef2FRuf",
            app,
        )
        self.assertIn("script.integrity = ZXING_INTEGRITY", app)
        self.assertIn("script.crossOrigin = \"anonymous\"", app)
        self.assertIn("tesseract.js@7.0.0", ocr)
        self.assertIn(
            "sha384-2BQ3U3OdKOb0Uczxqr41I9UvZkzr4V9Hv8uSzMMZAlmhsFClvdZX5wi5fDCzG+tM",
            ocr,
        )
        self.assertIn("script.integrity = TESSERACT_INTEGRITY", ocr)
        self.assertIn("script.crossOrigin = \"anonymous\"", ocr)

    def test_scanner_has_no_hidden_exfiltration_or_dynamic_code(self) -> None:
        javascript = "\n".join(
            (ROOT / filename).read_text(encoding="utf-8")
            for filename in ("app.js", "ocr.js")
        )

        for pattern in (
            r"\beval\s*\(",
            r"\bFunction\s*\(",
            r"\.innerHTML\s*=",
            r"\bWebSocket\s*\(",
            r"\blocalStorage\b",
        ):
            self.assertIsNone(re.search(pattern, javascript))

    def test_repository_contains_no_embedded_credentials(self) -> None:
        content = "\n".join(
            path.read_text(encoding="utf-8")
            for path in ROOT.iterdir()
            if path.is_file()
        )

        for pattern in (
            r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
            r"\bAIza[0-9A-Za-z_-]{30,}\b",
            r"\b\d{8,12}:[0-9A-Za-z_-]{30,}\b",
        ):
            self.assertIsNone(re.search(pattern, content))


if __name__ == "__main__":
    unittest.main()
