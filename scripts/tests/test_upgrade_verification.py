"""Check explicit ports for custom files that upstream did not change."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class UpgradeVerificationTests(unittest.TestCase):
    def test_manual_port_requires_an_explicit_declaration(self):
        helper = Path(__file__).resolve().parents[1] / 'verify-n8n-upgrade.mjs'
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
            git('init', '-q')
            git('config', 'user.name', 'Test User')
            git('config', 'user.email', 'test@example.com')
            (root / 'scripts').mkdir()
            shutil.copy2(helper, root / 'scripts' / helper.name)
            (root / 'packages/cli').mkdir(parents=True)
            for name in ['package.json', 'packages/cli/package.json']:
                (root / name).write_text(json.dumps({'version': '2.44.6'}))
            (root / 'custom.txt').write_text('upstream\n')
            git('add', '.')
            git('commit', '-qm', 'Base')
            base = git('rev-parse', 'HEAD')
            git('tag', 'n8n@2.44.6')
            (root / 'custom.txt').write_text('custom\n')
            git('commit', '-qam', 'Custom')
            source = git('rev-parse', 'HEAD')
            (root / 'custom.txt').write_text('custom\nmanual port\n')
            command = ['node', 'scripts/' + helper.name, '--version', '2.44.6',
                       '--base', base, '--source', source]
            for declared in [False, True]:
                with self.subTest(declared=declared):
                    result = subprocess.run(command + (['--ported', 'custom.txt'] if declared else []),
                                            cwd=root, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0 if declared else 1, result.stdout)


if __name__ == '__main__':
    unittest.main()
