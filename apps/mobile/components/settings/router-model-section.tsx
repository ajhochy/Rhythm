import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch as NativeSwitch, View } from 'react-native';
import { Button, Card, Chip, Dialog, HelperText, Portal, RadioButton, Text, TextInput } from 'react-native-paper';

import { Colors, MinimumTouchTarget, Radii, Spacing } from '@/constants/theme';
import {
  type RouterBackend,
  type RouterConfig,
  type RouterConfigDraft,
  type RouterFeatureKey,
  type RouterFeatureMode,
  type RouterRoutingScope,
  type RouterTestResult,
} from '@/providers/services/rhythm-tools-service';
import {
  buildCatalogPayload,
  parseThresholds,
  RouterCatalogSection,
  toCatalogDraft,
  type CatalogDraft,
} from './router-catalog-section';

type Palette = typeof Colors.light;

export interface RouterSettingsApi {
  get: () => Promise<RouterConfig>;
  save: (partial: RouterConfigDraft) => Promise<RouterConfig>;
  test: (draft?: RouterConfigDraft) => Promise<RouterTestResult>;
}

export const CONSENT_COPY = 'Prompts, tool names and memories will be sent to this server to rank them.';
export const LOCAL_HELPER_COPY =
  'Local means local to your paired Mac: the router model runs on the Mac, not on this phone.';

const BACKENDS: { value: RouterBackend; label: string }[] = [
  { value: 'local', label: 'Local on the Mac' },
  { value: 'jev', label: 'Jev API' },
  { value: 'custom', label: 'Custom network server' },
];
const MODES: { value: RouterFeatureMode; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'off', label: 'Off' },
  { value: 'shadow', label: 'Shadow' },
  { value: 'on', label: 'On' },
];
const SCOPES: { value: RouterRoutingScope; label: string; help: string }[] = [
  { value: 'first_prompt', label: 'First prompt only', help: 'Pick a model once per chat and keep it, so prompt caches stay warm.' },
  { value: 'escalate_only', label: 'Escalate only', help: 'Re-check every prompt but only move up to a stronger model, never down.' },
  { value: 'every_prompt', label: 'Every prompt', help: 'Re-route on every prompt; the model can change at any time.' },
];
const DEFAULT_ESCALATE_CONFIDENCE = 0.75;
const FEATURES: { key: RouterFeatureKey; label: string }[] = [
  { key: 'model_routing', label: 'Model routing' },
  { key: 'tool_ranking', label: 'Tool ranking' },
  { key: 'memory_ranking', label: 'Memory ranking' },
  { key: 'capacity_routing', label: 'Capacity routing' },
];

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Tolerant match of a settings path against the server's `lockedByEnv` keys. */
export function isLockedByEnv(locked: string[] | undefined, ...paths: string[]): boolean {
  if (!locked?.length) return false;
  const set = new Set(locked.map(norm));
  return paths.some((path) => set.has(norm(path)));
}

/** True when the URL points outside loopback / LAN, so data leaves the local network. */
export function isRemoteUrl(url: string): boolean {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(url.trim());
  if (!match) return false;
  const host = match[1].toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return false;
  const parts = host.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts;
    return !(a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254));
  }
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return false;
  return true;
}

/** User-facing message for a failed router-config call. */
export function routerErrorMessage(error: unknown): string {
  const e = (error && typeof error === 'object' ? error : {}) as {
    status?: number;
    code?: string;
    message?: string;
    kind?: string;
  };
  if (e.status === 401) return 'This device is not authorized on the Mac. Re-pair it and try again.';
  if (e.status === 403) return e.message || 'This action is not allowed for this device on the Mac.';
  if (e.status === 404) return 'The paired Mac does not support router settings yet. Update Rhythm on the Mac.';
  if (e.status === 0 || e.kind === 'network') return 'Could not reach the paired Mac.';
  if (e.message) return e.message;
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.';
}

interface FormState {
  backend: RouterBackend;
  localBaseUrl: string;
  localModel: string;
  localScale: string;
  jevModel: string;
  jevApiKey: string;
  jevClearKey: boolean;
  customBaseUrl: string;
  customModel: string;
  customScale: string;
  customApiKey: string;
  customClearKey: boolean;
  timeout: string;
  consent: boolean;
  features: Record<RouterFeatureKey, RouterFeatureMode>;
  scope: RouterRoutingScope;
  escalateMinConfidence: string;
  catalog: CatalogDraft | null;
}

function toForm(config: RouterConfig): FormState {
  return {
    backend: config.backend,
    localBaseUrl: config.local.baseUrl ?? '',
    localModel: config.local.model ?? '',
    localScale: config.local.scoreScale == null ? '' : String(config.local.scoreScale),
    jevModel: config.jev.model ?? '',
    jevApiKey: '',
    jevClearKey: false,
    customBaseUrl: config.custom.baseUrl ?? '',
    customModel: config.custom.model ?? '',
    customScale: config.custom.scoreScale == null ? '' : String(config.custom.scoreScale),
    customApiKey: '',
    customClearKey: false,
    timeout: String(config.timeoutMs ?? ''),
    consent: Boolean(config.remoteDataConsent),
    features: { ...config.features },
    scope: config.routing?.scope ?? 'first_prompt',
    escalateMinConfidence: String(config.routing?.escalateMinConfidence ?? DEFAULT_ESCALATE_CONFIDENCE),
    catalog: toCatalogDraft(config.catalog),
  };
}

function num(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Builds the PUT/test body. Locked fields are omitted; an apiKey is only
 * included when the user typed one or explicitly cleared the saved key.
 */
export function buildRouterPayload(form: FormState, config: RouterConfig, includeCatalog = false): RouterConfigDraft {
  const locked = config.lockedByEnv;
  const payload: RouterConfigDraft = {};
  if (!isLockedByEnv(locked, 'backend')) payload.backend = form.backend;

  const local: NonNullable<RouterConfigDraft['local']> = {};
  if (!isLockedByEnv(locked, 'local.baseUrl')) local.baseUrl = form.localBaseUrl.trim();
  if (!isLockedByEnv(locked, 'local.model')) local.model = form.localModel.trim();
  const localScale = num(form.localScale);
  if (localScale !== undefined && !isLockedByEnv(locked, 'local.scoreScale')) local.scoreScale = localScale;
  if (Object.keys(local).length) payload.local = local;

  const jev: NonNullable<RouterConfigDraft['jev']> = {};
  if (!isLockedByEnv(locked, 'jev.model')) jev.model = form.jevModel.trim();
  if (!isLockedByEnv(locked, 'jev.apiKey')) {
    if (form.jevApiKey) jev.apiKey = form.jevApiKey;
    else if (form.jevClearKey) jev.apiKey = '';
  }
  if (Object.keys(jev).length) payload.jev = jev;

  const custom: NonNullable<RouterConfigDraft['custom']> = {};
  if (!isLockedByEnv(locked, 'custom.baseUrl')) custom.baseUrl = form.customBaseUrl.trim();
  if (!isLockedByEnv(locked, 'custom.model')) custom.model = form.customModel.trim();
  const customScale = num(form.customScale);
  if (customScale !== undefined && !isLockedByEnv(locked, 'custom.scoreScale')) custom.scoreScale = customScale;
  if (!isLockedByEnv(locked, 'custom.apiKey')) {
    if (form.customApiKey) custom.apiKey = form.customApiKey;
    else if (form.customClearKey) custom.apiKey = '';
  }
  if (Object.keys(custom).length) payload.custom = custom;

  const timeoutMs = num(form.timeout);
  if (timeoutMs !== undefined && !isLockedByEnv(locked, 'timeoutMs')) payload.timeoutMs = timeoutMs;
  if (!isLockedByEnv(locked, 'remoteDataConsent')) payload.remoteDataConsent = form.consent;

  const features: Partial<Record<RouterFeatureKey, RouterFeatureMode>> = {};
  for (const { key } of FEATURES) {
    if (!isLockedByEnv(locked, `features.${key}`, key)) features[key] = form.features[key] ?? 'default';
  }
  if (Object.keys(features).length) payload.features = features;

  const routing: NonNullable<RouterConfigDraft['routing']> = {};
  if (!isLockedByEnv(locked, 'routing.scope')) routing.scope = form.scope;
  const minConfidence = num(form.escalateMinConfidence);
  if (minConfidence !== undefined && minConfidence >= 0 && minConfidence <= 1
    && !isLockedByEnv(locked, 'routing.escalateMinConfidence')) {
    routing.escalateMinConfidence = minConfidence;
  }
  if (Object.keys(routing).length) payload.routing = routing;
  if (includeCatalog && form.catalog && config.catalog) Object.assign(payload, buildCatalogPayload(config.catalog, form.catalog));
  return payload;
}

function needsConsent(form: FormState): boolean {
  return form.backend === 'jev' || (form.backend === 'custom' && isRemoteUrl(form.customBaseUrl));
}

export function RouterModelSection({ api, palette }: { api: RouterSettingsApi | null; palette: Palette }) {
  const [config, setConfig] = useState<RouterConfig>();
  const [loadError, setLoadError] = useState<string>();
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      setConfig(await api.get());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(routerErrorMessage(error));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = config
    ? `${BACKENDS.find((b) => b.value === (config.effective?.backend ?? config.backend))?.label ?? config.backend}${
        config.effective?.model ? ` · ${config.effective.model}` : ''
      }`
    : loadError ?? (api ? 'Loading…' : 'Pair a Mac to configure');

  return (
    <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}>
      <Card.Content style={styles.section}>
        <Text variant="titleLarge" style={{ color: palette.text }}>Router model</Text>
        <Text variant="bodyMedium" style={{ color: palette.muted }}>
          Choose the model that ranks models, tools and memories for Auto (router) sessions.
        </Text>
        <Text testID="router-summary" variant="bodyMedium" style={{ color: loadError ? palette.danger : palette.text }}>
          {summary}
        </Text>
        <Button
          accessibilityLabel="Configure router model"
          contentStyle={styles.touch}
          disabled={!api}
          mode="outlined"
          onPress={() => {
            setOpen(true);
            void load();
          }}
          testID="router-configure-button">
          Configure router model
        </Button>
      </Card.Content>
      {open && config ? (
        <Portal>
          <RouterConfigDialog
            api={api!}
            config={config}
            onDismiss={() => setOpen(false)}
            onSaved={(next) => {
              setConfig(next);
              setOpen(false);
            }}
            palette={palette}
          />
        </Portal>
      ) : null}
    </Card>
  );
}

export function RouterConfigDialog({
  api,
  config,
  onDismiss,
  onSaved,
  palette,
}: {
  api: RouterSettingsApi;
  config: RouterConfig;
  onDismiss: () => void;
  onSaved: (config: RouterConfig) => void;
  palette: Palette;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(config));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<RouterTestResult>();
  const locked = config.lockedByEnv;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const consentRequired = needsConsent(form);
  const consentMissing = consentRequired && !form.consent;
  const payload = useMemo(() => buildRouterPayload(form, config), [form, config]);
  const catalogInvalid = Boolean(form.catalog && config.catalog?.tiers && form.catalog.mode === 'manual' && !parseThresholds(form.catalog).ok);

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const saved = await api.save(buildRouterPayload(form, config, true));
      // Re-read so tiers/overrides shown are the server's, not the local preview.
      onSaved(await api.get().catch(() => saved));
    } catch (e) {
      setError(routerErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    setTesting(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.test(payload));
    } catch (e) {
      setError(routerErrorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  const field = (
    label: string,
    key: keyof FormState,
    lockPath: string,
    extra: Partial<React.ComponentProps<typeof TextInput>> = {},
  ) => (
    <TextInput
      accessibilityLabel={label}
      autoCapitalize="none"
      autoCorrect={false}
      disabled={isLockedByEnv(locked, lockPath)}
      key={key}
      label={label}
      mode="outlined"
      onChangeText={(value) => set(key, value as never)}
      right={isLockedByEnv(locked, lockPath) ? <TextInput.Icon icon="lock" /> : undefined}
      testID={`router-${key}`}
      value={String(form[key] ?? '')}
      {...extra}
    />
  );

  const keyField = (
    label: string,
    keyName: 'jevApiKey' | 'customApiKey',
    clearName: 'jevClearKey' | 'customClearKey',
    hasKey: boolean,
    lockPath: string,
  ) => {
    const keyLocked = isLockedByEnv(locked, lockPath);
    const saved = hasKey && !form[clearName];
    return (
      <View style={styles.group}>
        {field(label, keyName, lockPath, {
          placeholder: saved ? 'Key saved' : undefined,
          secureTextEntry: true,
        })}
        {saved && !keyLocked ? (
          <View style={styles.row}>
            <Text style={{ color: palette.muted }}>Key saved</Text>
            <Button accessibilityLabel={`Clear saved ${label}`} contentStyle={styles.touch} onPress={() => set(clearName, true)}>
              Clear key
            </Button>
          </View>
        ) : null}
        {hasKey && form[clearName] ? (
          <HelperText type="info">The saved key will be removed when you save.</HelperText>
        ) : null}
      </View>
    );
  };

  return (
    <Dialog visible onDismiss={onDismiss} style={styles.dialog}>
      <Dialog.Title>Router model</Dialog.Title>
      <Dialog.ScrollArea style={styles.scrollArea}>
        <ScrollView accessibilityViewIsModal contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text variant="labelLarge" style={{ color: palette.text }}>Backend</Text>
          <RadioButton.Group
            onValueChange={(value) => !isLockedByEnv(locked, 'backend') && set('backend', value as RouterBackend)}
            value={form.backend}>
            {BACKENDS.map((b) => (
              <Pressable
                accessibilityLabel={b.label}
                accessibilityRole="radio"
                accessibilityState={{ checked: form.backend === b.value, disabled: isLockedByEnv(locked, 'backend') }}
                disabled={isLockedByEnv(locked, 'backend')}
                key={b.value}
                onPress={() => set('backend', b.value)}
                style={styles.radioRow}>
                <RadioButton disabled={isLockedByEnv(locked, 'backend')} value={b.value} />
                <Text style={{ color: palette.text }}>{b.label}</Text>
              </Pressable>
            ))}
          </RadioButton.Group>

          {form.backend === 'local' ? (
            <View style={styles.group}>
              <HelperText type="info">{LOCAL_HELPER_COPY}</HelperText>
              {field('Base URL', 'localBaseUrl', 'local.baseUrl', { keyboardType: 'url', placeholder: 'http://127.0.0.1:8012' })}
              {field('Model', 'localModel', 'local.model')}
              {field('Score scale', 'localScale', 'local.scoreScale', { keyboardType: 'decimal-pad' })}
            </View>
          ) : null}
          {form.backend === 'jev' ? (
            <View style={styles.group}>
              {keyField('API key', 'jevApiKey', 'jevClearKey', config.jev.hasApiKey, 'jev.apiKey')}
              {field('Model', 'jevModel', 'jev.model')}
              <HelperText type="info">Requests go to {config.jev.baseUrl || 'the Jev API'}.</HelperText>
            </View>
          ) : null}
          {form.backend === 'custom' ? (
            <View style={styles.group}>
              {field('Base URL', 'customBaseUrl', 'custom.baseUrl', { keyboardType: 'url', placeholder: 'http://192.168.1.20:8012' })}
              {field('Model', 'customModel', 'custom.model')}
              {field('Score scale', 'customScale', 'custom.scoreScale', { keyboardType: 'decimal-pad' })}
              {keyField('API key (optional)', 'customApiKey', 'customClearKey', config.custom.hasApiKey, 'custom.apiKey')}
            </View>
          ) : null}

          {field('Timeout (ms)', 'timeout', 'timeoutMs', { keyboardType: 'number-pad' })}

          <Text variant="labelLarge" style={{ color: palette.text }}>Features</Text>
          {FEATURES.map((feature) => {
            const featureLocked = isLockedByEnv(locked, `features.${feature.key}`, feature.key);
            return (
              <View key={feature.key} style={styles.group}>
                <Text style={{ color: palette.text }}>{feature.label}{featureLocked ? ' (set by environment)' : ''}</Text>
                <View style={styles.chipWrap}>
                  {MODES.map((mode) => (
                    <Chip
                      accessibilityLabel={`${feature.label}: ${mode.label}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: form.features[feature.key] === mode.value, disabled: featureLocked }}
                      disabled={featureLocked}
                      key={mode.value}
                      onPress={() => set('features', { ...form.features, [feature.key]: mode.value })}
                      selected={form.features[feature.key] === mode.value}
                      style={styles.chip}
                      testID={`router-feature-${feature.key}-${mode.value}`}>
                      {mode.label}
                    </Chip>
                  ))}
                </View>
              </View>
            );
          })}

          <Text variant="labelLarge" style={{ color: palette.text }}>Routing scope</Text>
          {(() => {
            const scopeLocked = isLockedByEnv(locked, 'routing.scope');
            const current = SCOPES.find((s) => s.value === form.scope);
            return (
              <View style={styles.group}>
                {scopeLocked ? <Text style={{ color: palette.muted }}>Set by environment</Text> : null}
                <View style={styles.chipWrap}>
                  {SCOPES.map((scope) => (
                    <Chip
                      accessibilityLabel={`Routing scope: ${scope.label}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: form.scope === scope.value, disabled: scopeLocked }}
                      disabled={scopeLocked}
                      key={scope.value}
                      onPress={() => set('scope', scope.value)}
                      selected={form.scope === scope.value}
                      style={styles.chip}
                      testID={`router-scope-${scope.value}`}>
                      {scope.label}
                    </Chip>
                  ))}
                </View>
                <HelperText type="info">{current?.help}</HelperText>
              </View>
            );
          })()}
          {form.scope === 'escalate_only'
            ? (
              <View style={styles.group}>
                {field('Escalate min confidence', 'escalateMinConfidence', 'routing.escalateMinConfidence', { keyboardType: 'decimal-pad' })}
                <HelperText type="info">Only move up a tier when the router is at least this sure (0 to 1).</HelperText>
              </View>
            )
            : null}

          <RouterCatalogSection
            catalog={config.catalog}
            draft={form.catalog}
            onChange={(catalog) => set('catalog', catalog)}
            palette={palette}
          />

          {consentRequired ? (
            <View accessible accessibilityLabel="Send data to this server" style={styles.row}>
              <Text style={[styles.flex, { color: palette.text }]}>{CONSENT_COPY}</Text>
              <NativeSwitch
                accessibilityLabel="Allow sending data to this server"
                disabled={isLockedByEnv(locked, 'remoteDataConsent')}
                onValueChange={(value) => set('consent', value)}
                testID="router-consent-switch"
                thumbColor={Platform.OS === 'android' ? (form.consent ? palette.tint : '#f4f3f4') : undefined}
                trackColor={{ false: palette.border, true: `${palette.tint}66` }}
                value={form.consent}
              />
            </View>
          ) : null}
          {consentMissing ? <HelperText type="error">Turn this on to use this server.</HelperText> : null}

          <Button
            accessibilityLabel="Test connection"
            contentStyle={styles.touch}
            disabled={testing || saving || consentMissing}
            loading={testing}
            mode="outlined"
            onPress={() => void test()}
            testID="router-test-button">
            Test connection
          </Button>
          {result ? (
            <View accessibilityLiveRegion="polite" style={styles.group} testID="router-test-result">
              <Text style={{ color: result.ok ? palette.success : palette.danger }}>
                {result.ok ? 'Connection OK' : `Test failed${result.message ? `: ${result.message}` : ''}`}
              </Text>
              {result.ok ? (
                <Text style={{ color: palette.muted }}>
                  {[result.model, result.latencyMs != null ? `${result.latencyMs} ms` : undefined].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
              {result.ok && result.message ? <Text style={{ color: palette.muted }}>{result.message}</Text> : null}
              {result.ranked?.map((row, index) => (
                <Text key={`${row.text}-${index}`} style={{ color: palette.text }}>
                  {`${index + 1}. ${row.text} (${row.score.toFixed(2)})`}
                </Text>
              ))}
            </View>
          ) : null}
          {error ? (
            <HelperText accessibilityLiveRegion="polite" testID="router-error" type="error">
              {error}
            </HelperText>
          ) : null}
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        <Button onPress={onDismiss}>Cancel</Button>
        <Button
          disabled={saving || testing || consentMissing || catalogInvalid}
          loading={saving}
          onPress={() => void save()}
          testID="router-save-button">
          Save
        </Button>
      </Dialog.Actions>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radii.grouped },
  section: { gap: Spacing.x3 },
  touch: { minHeight: MinimumTouchTarget },
  dialog: { borderRadius: Radii.sheet, marginHorizontal: Spacing.x6 },
  scrollArea: { maxHeight: '70%', paddingHorizontal: Spacing.x6 },
  content: { gap: Spacing.x3, paddingVertical: Spacing.x2 },
  group: { gap: Spacing.x2 },
  row: { alignItems: 'center', flexDirection: 'row', gap: Spacing.x3, justifyContent: 'space-between', minHeight: MinimumTouchTarget },
  flex: { flex: 1 },
  radioRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.x2, minHeight: MinimumTouchTarget },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.x2 },
  chip: { justifyContent: 'center', minHeight: MinimumTouchTarget },
});
