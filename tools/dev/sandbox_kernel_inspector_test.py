"""Actual guarded private inspector contracts; no API/engine, socket or signals."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class KernelInspectorContract(unittest.TestCase):
    def test_actual_api_inspector_kernel_identity(self):
        # Bug: a setuid ps spawn stops startup, or a weaker inspector returns
        # supplied ownership data instead of current kernel UID/parent/start.
        parent = pathlib.Path(tempfile.mkdtemp(prefix='rhythm-kernel-inspector-contract-', dir='/private/tmp'))
        code = '''const fs=require('node:fs'),vm=require('node:vm'),ts=require(process.argv[1]);
const source=fs.readFileSync(process.argv[2],'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const context=vm.createContext({exports:{},require,process,__dirname:process.argv[3]});
vm.runInContext(compiled,context);
try{
if(vm.runInContext("ps(process.pid,'uid')",context)!==String(process.getuid()))process.exit(3);
if(vm.runInContext("ps(process.pid,'ppid')",context)!==String(process.ppid))process.exit(4);
const start=vm.runInContext("ps(process.pid,'lstart')",context);
if(!/^[A-Za-z]{3} [A-Za-z]{3} {1,2}[0-9]{1,2} [0-9:]{8} [0-9]{4}$/.test(start))process.exit(5);
const launch=vm.runInContext('launchArguments(process.pid)',context);
if(launch.env.HOME!=='/private/tmp'||!launch.argv.length||!launch.executable)process.exit(8);
const child=require('node:child_process').spawnSync('/bin/sleep',['0']);
if(child.status!==0||!child.pid)process.exit(9);
let dead=false;try{vm.runInContext("ps("+child.pid+",'uid')",context)}catch{dead=true;}if(!dead)process.exit(10);
let refused=false;try{vm.runInContext("ps(0,'uid')",context)}catch{refused=true;}if(!refused)process.exit(6);
refused=false;try{vm.runInContext("ps(process.pid,'unknown')",context)}catch{refused=true;}if(!refused)process.exit(7);
}catch{process.exit(2);}
'''
        result = subprocess.run(['/opt/homebrew/bin/node', '-e', code,
                                 str(ROOT / 'apps/api_server/node_modules/typescript'),
                                 str(ROOT / 'apps/api_server/src/services/sandbox_engine_attachment.ts'),
                                 str(ROOT / 'apps/api_server/src/services')], cwd=ROOT,
                                env={'HOME': '/private/tmp', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
                                capture_output=True)
        (parent / 'inspector.stderr').write_bytes(result.stderr)
        self.assertEqual(result.returncode, 0, 'actual guarded inspector cannot obtain exact kernel identity')

    def test_actual_recovery_start_and_stale_binding(self):
        # Bug: recovery falls back to setuid ps, accepts a dead PID or silently
        # replaces a captured start identity. No Rhythm role/ownership is faked.
        import importlib.util
        import os
        helper = ROOT / 'tools/dev/sandbox_api_recovery.py'
        spec = importlib.util.spec_from_file_location('recovery', helper)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        start = module.kernel_start(os.getpid())
        self.assertEqual(module.kernel_start(os.getpid()), start)
        self.assertNotEqual(start, 'different captured launch start')
        for pid in [0, 1, -1, 2147483648, '2']:
            with self.subTest(pid=pid):
                with self.assertRaises(ValueError):
                    module.kernel_start(pid)
        child = subprocess.Popen(['/bin/sleep', '0'],
                                 env={'HOME': '/private/tmp', 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin'})
        child.wait(timeout=5)
        with self.assertRaises(ValueError):
            module.kernel_start(child.pid)
        # Keep existing current-runtime envelope/UID/parent/argv/exe/store/config
        # validators rather than substitute metadata in the inspector contract.
        source = (ROOT / 'apps/api_server/src/services/sandbox_engine_attachment.ts').read_text()
        for required in ["ps(pid, 'uid') !== String(process.getuid?.())", "isolation(sb, port, launch.env)",
                         "launch.argv.length !== 4", "realpathSync(launch.executable)",
                         "ps(state.pid, 'ppid') !== String(apiPid)",
                         "JSON.stringify(saved.state) !== JSON.stringify(observed)"]:
            self.assertIn(required, source)


if __name__ == '__main__':
    unittest.main()
