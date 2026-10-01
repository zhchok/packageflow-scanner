from pathlib import Path
import shutil
import subprocess
import unittest


class ScannerFlowTests(unittest.TestCase):
    def test_real_javascript_flow(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node.js unavailable")
        script = Path(__file__).with_name("scanner_flow.cjs")
        result = subprocess.run(
            [node, str(script)], capture_output=True, text=True,
            timeout=15, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
