import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / "deploy-native-custom-stack.py"
spec = importlib.util.spec_from_file_location("native_deployment", path)
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)

class DeploymentSafetyTests(unittest.TestCase):
    def test_duplicate_service_is_rejected_before_mutation(self):
        old = {"Id": "old", "Config": {"Labels": {"com.docker.compose.service": "worker"}}}
        new = {"Id": "new", "Config": {"Labels": {"com.docker.compose.service": "worker"}}}
        with self.assertRaisesRegex(RuntimeError, "multiple containers.*worker"):
            deployment.service_records([old, new])

    def test_literal_environment_and_missing_runtime_keys_are_preserved(self):
        cfg = {"worker": {"environment": {"ENGINE": "vm", "NEW_SETTING": "x"}}}
        old = {"worker": {"Config": {"Env": ["ENGINE=legacy", "EXAMPLE_VALUE=abc$def=ghi"]}}}
        result = deployment.runtime_environment_override(cfg, old)
        self.assertEqual(result["services"]["worker"]["environment"],
                         {"ENGINE": "legacy", "NEW_SETTING": None, "EXAMPLE_VALUE": "abc$$def=ghi"})

if __name__ == "__main__":
    unittest.main()
