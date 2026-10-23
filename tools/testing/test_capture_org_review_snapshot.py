import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from capture_org_review_snapshot import capture_managed_skill_dependencies


class ManagedSkillSnapshotTest(unittest.TestCase):
    def test_exact_file_only_bytes_and_absence(self):
        with tempfile.TemporaryDirectory(prefix='rhythm-skill-capture-') as home:
            root = Path(home) / '.config/opencode/skills'
            (root / 'file-only').mkdir(parents=True)
            body = b'---\nname: file-only\n---\nExact source bytes.\n'
            (root / 'file-only/SKILL.md').write_bytes(body)
            with patch.object(Path, 'home', return_value=Path(home)):
                result = capture_managed_skill_dependencies([{
                    'allowed_skills_json': '["file-only","missing"]',
                }])
            self.assertEqual([entry['name'] for entry in result], ['file-only', 'missing'])
            self.assertEqual(result[0]['sha256'], hashlib.sha256(body).hexdigest())
            self.assertEqual(result[1], {'name': 'missing', 'state': 'absent'})

    def test_symlink_is_never_followed(self):
        with tempfile.TemporaryDirectory(prefix='rhythm-skill-capture-') as home:
            root = Path(home) / '.config/opencode/skills'
            root.mkdir(parents=True)
            (root / 'linked').symlink_to(Path(home))
            with patch.object(Path, 'home', return_value=Path(home)):
                with self.assertRaisesRegex(ValueError, 'symlink'):
                    capture_managed_skill_dependencies([{'allowed_skills_json': '["linked"]'}])


if __name__ == '__main__':
    unittest.main()
