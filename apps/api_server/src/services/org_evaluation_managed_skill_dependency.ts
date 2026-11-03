import { createHash } from 'node:crypto';
import { lstatSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { managedSkillsRoot, readManagedSkillBytes, slugForSkillName } from './rhythm_managed_skills';

type FrozenFile = { name: string; bytesBase64: string; sha256: string };

function statIfPresent(path: string): Stats | null {
  try { return lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Freeze the engine's actual managed source independently of optional DB sidecars. */
export function freezeEvaluationManagedSkillDependency(name: string,
  files: FrozenFile[], absences: string[]): { name: string; state: 'present' | 'absent'; sha256?: string } {
  const existing = files.find(file => file.name === name);
  if (existing) return { name, state: 'present', sha256: existing.sha256 };
  if (absences.includes(name)) return { name, state: 'absent' };
  const root = managedSkillsRoot();
  const directory = join(root, slugForSkillName(name));
  const path = join(directory, 'SKILL.md');
  const rootStat = statIfPresent(root);
  const directoryStat = statIfPresent(directory);
  const fileStat = statIfPresent(path);
  if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink()) ||
      directoryStat && (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) ||
      fileStat && (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1 ||
        process.getuid?.() !== undefined && fileStat.uid !== process.getuid()))
    throw new Error('Evaluation managed skill dependency is not one owned regular file');
  const bytes = readManagedSkillBytes(name);
  if (bytes === null) {
    absences.push(name);
    return { name, state: 'absent' };
  }
  if (bytes.length > 128_000) throw new Error('Evaluation managed skill dependency exceeds byte bound');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  files.push({ name, bytesBase64: bytes.toString('base64'), sha256 });
  return { name, state: 'present', sha256 };
}
