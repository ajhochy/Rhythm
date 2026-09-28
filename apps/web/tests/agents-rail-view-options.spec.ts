import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('view options replaces standalone checkboxes and supports keyboard selection and return focus', async ({ page }) => {
  await page.goto('/agents');
  const rail = page.getByRole('complementary', { name: 'Agents', exact: true });
  const trigger = rail.getByRole('button', { name: 'View options', exact: true });
  await expect(rail.getByRole('checkbox', { name: /Archived sessions|Compact rows/ })).toHaveCount(0);
  const selected = await rail.locator('[aria-current="true"]').getAttribute('data-testid');
  await trigger.focus();
  // Menu order: Sort radios, archived view, Row spacing radios, Refresh, Add project.
  await trigger.press('ArrowDown');
  const newest = page.getByRole('menuitemradio', { name: 'Date · newest', exact: true });
  await expect(newest).toBeFocused();
  await expect(newest).toHaveAttribute('aria-checked', 'true');
  for (let step = 0; step < 5; step += 1) await page.keyboard.press('ArrowDown');
  const archive = page.getByRole('menuitemcheckbox', { name: 'View archived sessions' });
  await expect(archive).toBeFocused();
  await expect(archive).toHaveAttribute('aria-checked', 'false');
  await expect(archive).toHaveAccessibleDescription('Shows archived conversations instead of active ones. Does not archive anything.');
  await archive.press('ArrowDown');
  const comfortable = page.getByRole('menuitemradio', { name: 'Comfortable', exact: true });
  await expect(comfortable).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const compact = page.getByRole('menuitemradio', { name: 'Compact', exact: true });
  await expect(compact).toBeFocused();
  // Compact is the default spacing; choosing Comfortable by keyboard switches the list and returns focus.
  await expect(compact).toHaveAttribute('aria-checked', 'true');
  await expect(rail.locator('.session-list')).toHaveClass(/rail-compact/);
  await page.keyboard.press('ArrowUp');
  await comfortable.press('Space');
  await expect(trigger).toBeFocused();
  await expect(rail.locator('.session-list')).not.toHaveClass(/rail-compact/);
  await trigger.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: 'Add project', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: 'Refresh sessions', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(compact).toBeFocused();
  await expect(compact).toHaveAttribute('aria-checked', 'false');
  await expect(comfortable).toHaveAttribute('aria-checked', 'true');
  await compact.press('Home');
  await expect(newest).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Add project', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('menu', { name: 'View options' })).toHaveCount(0);
  expect(await rail.locator('[aria-current="true"]').getAttribute('data-testid')).toBe(selected);
});

test('archive is an explicit view with an obvious return path, without mutating sessions', async ({ page }) => {
  await page.goto('/agents');
  const before = await page.evaluate(() => localStorage.getItem('rhythm-agents-fixture-sessions'));
  const trigger = page.getByRole('button', { name: 'View options', exact: true });
  await trigger.click();
  await page.getByRole('menuitemcheckbox', { name: 'View archived sessions' }).click();
  const back = page.getByRole('button', { name: 'Archived sessions — Back to active', exact: true });
  await expect(back).toBeVisible();
  await trigger.click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'View archived sessions' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await back.click();
  await expect(back).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('rhythm-agents-fixture-sessions'))).toBe(before);
});

test('sort, archive, and density preferences persist across reload and stay isolated per account', async ({ page }) => {
  await page.route('**/tests/rail-view-preferences-fixture.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><title>Rail preferences fixture</title></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    const {default: React} = await import('/.vite/deps/react.js');
    const {default: {createRoot}} = await import('/.vite/deps/react-dom_client.js');
    const {FixtureProvider} = await import('/src/store.tsx');
    const {composeGateway} = await import('/src/gateway/index.ts');
    const {GatewayProvider} = await import('/src/gateway/context.tsx');
    const {AuthUserProvider} = await import('/src/gateway/auth.tsx');
    const {SessionRail} = await import('/src/components/SessionRail.tsx');
    await import('/src/styles.css');
    const h = React.createElement; const gateway = composeGateway({mode:'fixture'});
    function App() { const [userId, setUserId] = React.useState(101); return h('main', {style:{width:'300px',height:'100vh',display:'grid',gridTemplateRows:'auto minmax(0,1fr)'}},
      h('button', {type:'button','data-testid':'switch-account',onClick:()=>setUserId(id=>id===101?202:101)}, 'Switch account'),
      h(AuthUserProvider,{key:userId,user:{id:userId,name:'User '+userId,email:userId+'@example.invalid',role:'user'}},
        h(GatewayProvider,{gateway},h(FixtureProvider,null,h(SessionRail,{collapsed:false,onToggle:()=>{},selectedProject:null,onSelectProject:()=>{}}))))); }
    createRoot(document.getElementById('root')).render(h(App));
  </script></body></html>` }));
  await page.goto('/tests/rail-view-preferences-fixture.html');
  const viewOptions = page.getByRole('button', { name: 'View options', exact: true });
  const sortName = page.getByRole('menuitemradio', { name: 'Name', exact: true });
  const sortNewest = page.getByRole('menuitemradio', { name: 'Date · newest', exact: true });
  // Compact is the default, so the non-default Comfortable spacing proves density persistence.
  await viewOptions.click();
  await sortName.click();
  await viewOptions.click();
  await page.getByRole('menuitemradio', { name: 'Comfortable', exact: true }).click();
  await viewOptions.click();
  await page.getByRole('menuitemcheckbox', { name: 'View archived sessions' }).click();

  await page.getByTestId('switch-account').click();
  await viewOptions.click();
  await expect(sortNewest).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio', { name: 'Compact', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemcheckbox', { name: 'View archived sessions' })).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  await page.getByTestId('switch-account').click();
  await expect(page.getByRole('button', { name: 'Archived sessions — Back to active', exact: true })).toBeVisible();
  await viewOptions.click();
  await expect(sortName).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.reload();
  await viewOptions.click();
  await expect(sortName).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio', { name: 'Comfortable', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemcheckbox', { name: 'View archived sessions' })).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rhythm.settings.101') ?? '{}'))).toMatchObject({ sessionSort: 'name', archivedOnly: true, compact: false });
  expect(await page.evaluate(() => localStorage.getItem('rhythm.settings.202'))).toBeNull();
});

for (const theme of ['light', 'dark']) test(`narrow rail at 200 percent with RTL keeps ${theme} view options contained and accessible`, async ({ page }, testInfo) => {
  await page.goto('/agents');
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.dir = 'rtl'; document.documentElement.style.zoom = '2'; }, theme);
  const rail = page.getByRole('complementary', { name: 'Agents', exact: true });
  await rail.evaluate(element => { element.style.width = '228px'; });
  await rail.getByRole('button', { name: 'View options', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'View options' });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const railBox = (await rail.boundingBox())!;
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(railBox.x);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(railBox.x + railBox.width);
  const axe = await new AxeBuilder({ page }).include('.session-rail').analyze();
  expect(axe.violations).toEqual([]);
  await rail.screenshot({ path: testInfo.outputPath(`view-options-${theme}-rtl-200.png`) });
});

test('an untitled session never renders as a blank row: first prompt, else "New session", muted', async ({ page }) => {
  await page.goto('/agents');
  const rail = page.getByRole('complementary', { name: 'Agents', exact: true });
  await expect(rail.locator('[data-testid^="session-name-"]').first()).toBeVisible();
  // Blank out two rows that are currently rendered in the rail.
  const visibleIds = (await rail.locator('[data-testid^="session-name-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')!.replace('session-name-', '')))).slice(0, 2);
  const ids = await page.evaluate((targets) => {
    const sessions = JSON.parse(localStorage.getItem('rhythm-agents-fixture-sessions') ?? '[]') as Array<Record<string, unknown>>;
    const [withPrompt, bare] = targets.map((id) => sessions.find((session) => session.id === id)!);
    withPrompt.name = '';
    withPrompt.firstPrompt = '  give me repo state in plain language.\nsecond line';
    bare.name = '';
    delete bare.firstPrompt;
    localStorage.setItem('rhythm-agents-fixture-sessions', JSON.stringify(sessions));
    return { withPrompt: String(withPrompt.id), bare: String(bare.id) };
  }, visibleIds);
  await page.reload();
  const promptName = rail.getByTestId(`session-name-${ids.withPrompt}`);
  await expect(promptName).toHaveText('give me repo state in plain language.');
  await expect(promptName).toHaveClass(/session-name-fallback/);
  await expect(promptName).toHaveCSS('font-style', 'italic');
  const bareName = rail.getByTestId(`session-name-${ids.bare}`);
  await expect(bareName).toHaveText('New session');
  await expect(bareName).toHaveClass(/session-name-fallback/);
  // Named sessions keep their real name and normal styling.
  const named = rail.locator('[data-testid^="session-name-"]:not(.session-name-fallback)').first();
  await expect(named).not.toHaveText('');
});
