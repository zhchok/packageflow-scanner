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

    def test_camera_is_released_after_final_confirmation(self) -> None:
        body = function_body("confirmCandidate", "hasLiveCamera")
        self.assertIn("stopCamera();", body)

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


if __name__ == "__main__":
    unittest.main()
