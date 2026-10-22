"""Check public image modes without changing private build records."""
from pathlib import Path
import subprocess
import tempfile
import unittest


class ImageArtifactPermissionsTests(unittest.TestCase):
    def test_public_assets_become_readable_and_private_files_stay_private(self):
        script = Path(__file__).resolve().parents[1] / 'normalize-image-artifacts.sh'
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for relative in ['compiled', 'dist/task-runner-javascript', 'docker/images']:
                directory = root / relative
                directory.mkdir(parents=True)
                directory.chmod(0o700)
                asset = directory / 'package.json'
                asset.write_text('{}')
                asset.chmod(0o600)
                executable = directory / 'start'
                executable.write_text('#!/bin/sh\n')
                executable.chmod(0o700)
            private = root / 'private-config'
            private.write_text('test fixture')
            private.chmod(0o600)
            result = subprocess.run(['sh', str(script), str(root)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            for relative in ['compiled', 'dist/task-runner-javascript', 'docker/images']:
                directory = root / relative
                self.assertEqual(directory.stat().st_mode & 0o777, 0o755)
                self.assertEqual((directory / 'package.json').stat().st_mode & 0o777, 0o644)
                self.assertEqual((directory / 'start').stat().st_mode & 0o777, 0o755)
            self.assertEqual(private.stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
