from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
APP_JS = (ROOT / "app.js").read_text(encoding="utf-8")


def function_body(name: str, next_name: str) -> str:
    start = APP_JS.index(f"function {name}")
    end = APP_JS.index(f"function {next_name}", start)
    return APP_JS[start:end]


class CameraLifecycleTests(unittest.TestCase):
    def test_candidate_pauses_scanning_without_releasing_camera(self) -> None:
        body = function_body("presentCandidate", "confirmCandidate")
        self.assertIn("pauseScanning();", body)
        self.assertNotIn("stopCamera();", body)

    def test_rescan_reuses_live_stream(self) -> None:
        body = function_body("rescan", "loadZxing")
        self.assertIn("void resumeScanner();", body)
        self.assertNotIn("startScanner(", body)

    def test_confirmation_uses_api_without_releasing_camera(self) -> None:
        body = function_body("confirmCandidate", "saveUnknown")
        self.assertIn('receivingApi("lookup"', body)
        self.assertNotIn("stopCamera();", body)
        self.assertNotIn("sendData(", body)

    def test_next_package_reuses_live_camera(self) -> None:
        body = function_body("nextPackage", "finishReceivingSession")
        self.assertIn("void resumeScanner();", body)
        self.assertNotIn("stopCamera();", body)
        self.assertNotIn("startScanner(", body)

    def test_camera_is_released_only_when_session_finishes(self) -> None:
        body = function_body("finishReceivingSession", "hasLiveCamera")
        self.assertIn("stopCamera();", body)
        self.assertIn("telegram?.close();", body)

    def test_start_does_not_reopen_camera_to_select_preferred_lens(self) -> None:
        start = APP_JS.index("async function startScanner")
        end = APP_JS.index("switchCameraButton.addEventListener", start)
        body = APP_JS[start:end]
        self.assertEqual(body.count("getUserMedia("), 1)
        self.assertNotIn("startScanner(preferredDevice.deviceId)", body)
        self.assertIn("preferredCameraBeforeAccess()", body)

    def test_preferred_camera_is_persisted_for_next_opening(self) -> None:
        self.assertIn("PREFERRED_CAMERA_STORAGE_KEY", APP_JS)
        self.assertIn("storePreferredCameraId(", APP_JS)
        self.assertIn("readStoredPreferredCameraId()", APP_JS)

    def test_unknown_cancel_returns_to_same_live_camera(self) -> None:
        self.assertIn('currentLookup?.kind === "unknown"', APP_JS)
        self.assertIn("nextPackage();", APP_JS)


class DeploymentRouteTests(unittest.TestCase):
    def test_caddy_routes_dev_and_production_api_separately(self) -> None:
        caddy = (ROOT / "deploy" / "Caddyfile.dev").read_text(encoding="utf-8")

        self.assertIn("handle /dev/api/*", caddy)
        self.assertIn("reverse_proxy packageflow-dev-api:8080", caddy)
        self.assertIn("handle /api/*", caddy)
        self.assertIn("reverse_proxy packageflow-prod-api:8080", caddy)

    def test_scanner_joins_private_receiving_api_network(self) -> None:
        compose = (ROOT / "deploy" / "compose.dev.yml").read_text(
            encoding="utf-8"
        )

        self.assertIn("packageflow-scanner-api", compose)
        self.assertNotIn('"8080:8080"', compose)


if __name__ == "__main__":
    unittest.main()
