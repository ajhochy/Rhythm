import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { patchPodfile } = require('../plugins/with-ios-fmt-cxx17');

const expoPodfile = `target 'RhythmAgents' do
  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
    )
  end
end
`;

test('generated iOS Podfile limits only fmt to C++17', () => {
  const patched = patchPodfile(expoPodfile);

  assert.match(patched, /next unless target\.name == 'fmt'/);
  assert.match(
    patched,
    /build_settings\['CLANG_CXX_LANGUAGE_STANDARD'\] = 'c\+\+17'/,
  );
  assert.equal(patchPodfile(patched), patched, 'patch must be idempotent');
});

test('plugin fails loudly if the Expo Podfile template changes', () => {
  assert.throws(
    () => patchPodfile("target 'RhythmAgents' do\nend\n"),
    /Expo Podfile template changed/,
  );
});
