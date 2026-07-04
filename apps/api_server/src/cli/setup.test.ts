import { describe, expect, it } from 'vitest';

import { parseSetupArgs } from './setup';

describe('parseSetupArgs', () => {
  it('recognizes --quick', () => {
    expect(parseSetupArgs(['--quick'])).toEqual({ mode: 'quick' });
  });

  it('recognizes --full', () => {
    expect(parseSetupArgs(['--full'])).toEqual({ mode: 'full' });
  });

  it('recognizes --blank-slate', () => {
    expect(parseSetupArgs(['--blank-slate'])).toEqual({ mode: 'blank-slate' });
  });

  it('returns null mode when no flag is given (interactive mode selection)', () => {
    expect(parseSetupArgs([])).toEqual({ mode: null });
  });
});
