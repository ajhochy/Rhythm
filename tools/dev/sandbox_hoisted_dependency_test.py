"""Generated-link block contract: resolver only, never loads/starts server or builds."""
import hashlib
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


def generated_link_block():
    text = (ROOT / 'tools/dev/sandbox.sh').read_text()
    block = text.split('build_preserved_payloads() {', 1)[1].split('\n}\n', 1)[0]
    return block.split("python3 -I -c '\n", 1)[1].rsplit("' \"$ROOT\" \"$SB\"", 1)[0]


class HoistedDependencyContract(unittest.TestCase):
    def test_real_generated_consumer_resolves_hoisted_dependency(self):
        # Bug: preserved server finds app-local modules but cannot resolve a root-
        # hoisted dependency. Actor: external payload consumer, actual createRequire.
        self.assertFalse((ROOT / 'apps/api_server/node_modules/undici').exists())
        self.assertTrue((ROOT / 'node_modules/undici').is_dir())
        parent = pathlib.Path(tempfile.mkdtemp(prefix='rhythm-coordinator-hoisted-contract-', dir='/private/tmp'))
        sb = parent / 'runtime'
        (sb / 'dist').mkdir(parents=True, mode=0o700)
        (sb / 'mcp-dist').mkdir(mode=0o700)
        server = sb / 'dist/server.js'
        server.write_text('// Inert generated-entry fixture; not executed.\n')
        result = subprocess.run([sys.executable, '-I', '-c', generated_link_block(), str(ROOT), str(sb)],
                                env={'HOME': '/private/tmp', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
                                capture_output=True)
        (parent / 'links.stderr').write_bytes(result.stderr)
        self.assertEqual(result.returncode, 0, 'actual generated link block failed')
        code = "const {createRequire}=require('node:module');try{const p=createRequire(process.argv[1]).resolve('undici');if(!p.startsWith(process.argv[2]+'/'))process.exit(3);}catch{process.exit(2);}"
        consumed = subprocess.run(['/opt/homebrew/bin/node', '-e', code, str(server), str(ROOT / 'node_modules/undici')],
                                  env={'HOME': '/private/tmp', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
                                  capture_output=True)
        (parent / 'resolution.stderr').write_bytes(consumed.stderr)
        self.assertEqual(consumed.returncode, 0, 'real generated consumer cannot resolve root-hoisted undici')
        self.assertEqual((sb / 'node_modules').resolve(), (ROOT / 'node_modules').resolve())
        self.assertEqual((sb / 'dist/node_modules').resolve(), (ROOT / 'apps/api_server/node_modules').resolve())
        self.assertEqual((sb / 'mcp-dist/node_modules').resolve(), (ROOT / 'apps/mcp_server/node_modules').resolve())
        before = os.readlink(sb / 'node_modules')
        refused = subprocess.run([sys.executable, '-I', '-c', generated_link_block(), str(ROOT), str(sb)],
                                 env={'HOME': '/private/tmp', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
                                 capture_output=True)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(os.readlink(sb / 'node_modules'), before)
        self.assertEqual(server.read_text(), '// Inert generated-entry fixture; not executed.\n')


if __name__ == '__main__':
    unittest.main()
