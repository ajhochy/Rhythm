/** Reset only test-owned provider controls/config. Never clear captures, sessions or cooldowns. */
export async function resetGridCaseState(
  control: (body: object) => Promise<unknown>,
  configure: () => Promise<unknown>,
  refreshUsage: () => Promise<unknown>,
) {
  await control({ unknown: false, fail429: [], malformed: false, usage: {
    'openai-a': { five: 40, week: 50 }, 'openai-b': { five: 5, week: 10 },
    'anthropic-a': { five: 40, week: 50 }, 'anthropic-b': { five: 5, week: 10 },
  } });
  await configure();
  await refreshUsage();
}
