import { StyleSheet, Switch as NativeSwitch, View } from 'react-native';
import { Button, Chip, HelperText, Text, TextInput } from 'react-native-paper';

import { Colors, MinimumTouchTarget, Spacing } from '@/constants/theme';
import type {
  RouterCatalog,
  RouterCatalogModel,
  RouterConfigDraft,
  RouterTier,
  RouterTierMode,
  RouterTierSource,
  RouterTierThresholds,
} from '@/providers/services/rhythm-tools-service';

// "Models the router chooses among" — docs/ai/plans/2026-09-29-local-decision-engine.md, "Addendum: Route
// among the LIVE model catalog". Displayed tiers are a cosmetic preview; the server is authoritative after save.

type Palette = typeof Colors.light;

export const CATALOG_UNAVAILABLE =
  'Catalog unavailable — the engine is not running; the router will use the static fallback table';
export const NO_CURATED_MODELS =
  'No models are enabled in Models curation — the router will keep each chat\'s current model until you enable some.';
export const NOT_ENABLED_LABEL = 'Not enabled in Models curation';
export const TIERS: RouterTier[] = ['cheap', 'standard', 'frontier'];

export interface CatalogDraft {
  mode: RouterTierMode;
  cheapMax: string;
  frontierMin: string;
  /** Touched models only: a chosen tier, or 'derived' to drop an override. */
  tiers: Record<string, RouterTier | 'derived'>;
  excluded: string[];
}

export type ThresholdResult = { ok: true; value: RouterTierThresholds } | { ok: false; message: string };

export const isEnabled = (m: Pick<RouterCatalogModel, 'enabled'>) => m.enabled !== false;
export const modelKey = (m: Pick<RouterCatalogModel, 'providerID' | 'modelID'>) => `${m.providerID}/${m.modelID}`;

export function toCatalogDraft(catalog: RouterCatalog | null | undefined): CatalogDraft | null {
  if (!catalog) return null;
  return {
    mode: catalog.tiers?.mode === 'manual' ? 'manual' : 'auto',
    cheapMax: String(catalog.tiers?.cheapMaxOutputUsd ?? ''),
    frontierMin: String(catalog.tiers?.frontierMinOutputUsd ?? ''),
    tiers: {},
    excluded: (catalog.models ?? []).filter((m) => isEnabled(m) && m.excluded).map(modelKey),
  };
}

export function parseThresholds(draft: Pick<CatalogDraft, 'cheapMax' | 'frontierMin'>): ThresholdResult {
  const cheap = draft.cheapMax.trim() === '' ? NaN : Number(draft.cheapMax);
  const frontier = draft.frontierMin.trim() === '' ? NaN : Number(draft.frontierMin);
  if (!Number.isFinite(cheap) || !Number.isFinite(frontier)) return { ok: false, message: 'Enter a price for both thresholds.' };
  if (cheap <= 0 || frontier <= 0) return { ok: false, message: 'Thresholds must be greater than 0.' };
  if (cheap >= frontier) return { ok: false, message: 'Cheap threshold must be lower than the frontier threshold.' };
  return { ok: true, value: { cheapMaxOutputUsd: cheap, frontierMinOutputUsd: frontier } };
}

const tierForCost = (usd: number, t: RouterTierThresholds): RouterTier =>
  usd <= t.cheapMaxOutputUsd ? 'cheap' : usd >= t.frontierMinOutputUsd ? 'frontier' : 'standard';

export function effectiveTier(
  model: RouterCatalogModel,
  draft: CatalogDraft,
  serverTiers: RouterTierThresholds,
): { tier: RouterTier; source: RouterTierSource } {
  const parsed = parseThresholds(draft);
  const thresholds = parsed.ok ? parsed.value : serverTiers;
  // Local re-tiering preview exists only in manual mode; in auto the server's tiers stand.
  const preview = draft.mode === 'manual';
  const choice = draft.tiers[modelKey(model)];
  const hasCost = typeof model.costOutputUsd === 'number';
  if (choice && choice !== 'derived') return { tier: choice, source: 'override' };
  if (choice === 'derived') {
    return hasCost
      ? { tier: tierForCost(model.costOutputUsd as number, thresholds), source: 'cost' }
      : { tier: model.tier, source: 'heuristic' };
  }
  if (preview && model.tierSource === 'cost' && hasCost) return { tier: tierForCost(model.costOutputUsd as number, thresholds), source: 'cost' };
  return { tier: model.tier, source: model.tierSource };
}

/** Catalog part of the PUT body. Overrides = models the user changed plus those already overridden (minus resets). */
export function buildCatalogPayload(
  catalog: RouterCatalog,
  draft: CatalogDraft,
): Pick<RouterConfigDraft, 'tiers' | 'tierOverrides' | 'excludedModels'> {
  const out: Pick<RouterConfigDraft, 'tiers' | 'tierOverrides' | 'excludedModels'> = {};
  if (draft.mode === 'auto') out.tiers = { mode: 'auto' };
  else {
    const parsed = parseThresholds(draft);
    if (parsed.ok) out.tiers = { mode: 'manual', ...parsed.value };
  }
  // Nothing to edit (engine down): leave saved overrides/exclusions untouched instead of wiping them.
  if (!catalog.models.length) return out;
  const overrides: Record<string, RouterTier> = {};
  for (const model of catalog.models) {
    if (!isEnabled(model)) continue;
    const key = modelKey(model);
    const choice = draft.tiers[key];
    if (choice === 'derived') continue;
    if (choice) overrides[key] = choice;
    else if (model.tierSource === 'override') overrides[key] = model.tier;
  }
  out.tierOverrides = overrides;
  out.excludedModels = catalog.models.filter(isEnabled).map(modelKey).filter((key) => draft.excluded.includes(key));
  return out;
}

const usd = (v: number | null | undefined) => (typeof v === 'number' ? `$${Number(v.toFixed(4))}` : '—');
const context = (v: number | null | undefined) =>
  typeof v === 'number' && v > 0 ? (v >= 1_000_000 ? `${Number((v / 1_000_000).toFixed(2))}M` : `${Math.round(v / 1000)}K`) : '—';
const titleCase = (s: string) => s[0].toUpperCase() + s.slice(1);

export function RouterCatalogSection({
  catalog,
  draft,
  onChange,
  palette,
}: {
  catalog: RouterCatalog | null | undefined;
  draft: CatalogDraft | null;
  onChange: (draft: CatalogDraft) => void;
  palette: Palette;
}) {
  const models = catalog?.models ?? [];
  const auto = draft?.mode !== 'manual';
  const thresholds = draft && !auto ? parseThresholds(draft) : null;
  const patch = (next: Partial<CatalogDraft>) => {
    if (draft) onChange({ ...draft, ...next });
  };
  const hasModels = Boolean(catalog && draft && models.length);

  return (
    <View style={styles.group} testID="router-catalog">
      <Text accessibilityRole="header" variant="labelLarge" style={{ color: palette.text }}>
        Models the router chooses among
      </Text>
      {hasModels || catalog?.reason ? (
        <Text style={{ color: palette.text }} testID="router-catalog-count">
          {`Routing among ${catalog?.curatedCount ?? models.filter(isEnabled).length} enabled models`}
        </Text>
      ) : null}
      {catalog?.reason === 'no_curated_models' ? (
        <Text accessibilityRole="alert" style={{ color: palette.text }} testID="router-catalog-no-curated">
          {NO_CURATED_MODELS}
        </Text>
      ) : null}
      {catalog && draft && catalog.tiers ? (
        <View style={styles.group}>
          <Text style={{ color: palette.text }}>Tier thresholds</Text>
          <View style={styles.chipWrap}>
            {(['auto', 'manual'] as const).map((mode) => (
              <Chip
                accessibilityLabel={`Tier thresholds: ${mode === 'auto' ? 'Auto' : 'Manual'}`}
                accessibilityRole="radio"
                key={mode}
                onPress={() => patch({ mode })}
                selected={draft.mode === mode}
                style={styles.chip}
                testID={`router-catalog-mode-${mode}`}>
                {mode === 'auto' ? 'Auto' : 'Manual'}
              </Chip>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Cheap: up to dollars per million output tokens"
            editable={!auto}
            disabled={auto}
            keyboardType="decimal-pad"
            label="Cheap: up to $/M output"
            mode="outlined"
            onChangeText={(value) => patch({ cheapMax: value })}
            testID="router-catalog-cheap-max"
            value={draft.cheapMax}
          />
          <TextInput
            accessibilityLabel="Frontier: from dollars per million output tokens"
            editable={!auto}
            disabled={auto}
            keyboardType="decimal-pad"
            label="Frontier: from $/M output"
            mode="outlined"
            onChangeText={(value) => patch({ frontierMin: value })}
            testID="router-catalog-frontier-min"
            value={draft.frontierMin}
          />
          {thresholds && !thresholds.ok ? (
            <HelperText accessibilityLiveRegion="polite" testID="router-catalog-threshold-error" type="error">
              {thresholds.message}
            </HelperText>
          ) : (
            <HelperText testID="router-catalog-mode-hint" type="info">
              {auto
                ? `Derived from ${catalog.tiers.derivedFromModels ?? 0} catalog prices`
                : 'Manual cutoffs preview models tiered by cost; the Mac decides after you save.'}
            </HelperText>
          )}
        </View>
      ) : null}
      {!hasModels ? (
        <Text style={{ color: palette.muted }} testID="router-catalog-empty">
          {CATALOG_UNAVAILABLE}
        </Text>
      ) : (
        TIERS.map((tier) => {
          const rows = models
            .map((model) => ({ model, eff: effectiveTier(model, draft!, catalog!.tiers) }))
            .filter((row) => row.eff.tier === tier);
          if (!rows.length) return null;
          return (
            <View key={tier} style={styles.group} testID={`router-catalog-group-${tier}`}>
              <Text accessibilityRole="header" style={{ color: palette.muted }}>
                {`${titleCase(tier)} (${rows.length})`}
              </Text>
              {rows.map(({ model, eff }) => {
                const key = modelKey(model);
                const enabled = isEnabled(model);
                const excluded = enabled && draft!.excluded.includes(key);
                return (
                  <View key={key} style={[styles.row, { borderColor: palette.border, opacity: !enabled ? 0.5 : excluded ? 0.6 : 1 }]} testID={`router-model-row-${key}`}>
                    <Text style={{ color: palette.text }}>{model.name}</Text>
                    {!enabled ? (
                      <Text style={{ color: palette.muted }} testID={`router-model-not-enabled-${key}`}>
                        {NOT_ENABLED_LABEL}
                      </Text>
                    ) : null}
                    <Text style={{ color: palette.muted }}>{`${model.providerID} · ${model.modelID}`}</Text>
                    <View style={styles.chipWrap}>
                      {TIERS.map((option) => (
                        <Chip
                          accessibilityLabel={`Tier for ${model.name}: ${option}`}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: eff.tier === option, disabled: !enabled }}
                          disabled={!enabled}
                          key={option}
                          onPress={() => patch({ tiers: { ...draft!.tiers, [key]: option } })}
                          selected={eff.tier === option}
                          style={styles.chip}
                          testID={`router-model-tier-${key}-${option}`}>
                          {option}
                        </Chip>
                      ))}
                    </View>
                    <View style={styles.inline}>
                      <Text style={{ color: palette.muted }} testID={`router-model-source-${key}`}>
                        {eff.source}
                      </Text>
                      {enabled && eff.source === 'override' ? (
                        <Button
                          accessibilityLabel={`Reset ${model.name} to derived tier`}
                          contentStyle={styles.touch}
                          onPress={() => patch({ tiers: { ...draft!.tiers, [key]: 'derived' } })}
                          testID={`router-model-reset-${key}`}>
                          Reset to derived
                        </Button>
                      ) : null}
                    </View>
                    <Text style={{ color: palette.muted }}>
                      {`Out ${usd(model.costOutputUsd)}/M · In ${usd(model.costInputUsd)}/M · ${model.releaseDate || '—'} · ${context(model.contextLimit)} context`}
                    </Text>
                    <View style={styles.inline}>
                      <Text style={[styles.flex, { color: palette.text }]}>Exclude</Text>
                      <NativeSwitch
                        accessibilityLabel={`Exclude ${model.name}`}
                        disabled={!enabled}
                        onValueChange={(value) =>
                          patch({
                            excluded: value ? [...draft!.excluded, key] : draft!.excluded.filter((entry) => entry !== key),
                          })
                        }
                        testID={`router-model-exclude-${key}`}
                        value={excluded}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.x2 },
  row: { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, gap: Spacing.x1, padding: Spacing.x2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.x2 },
  chip: { justifyContent: 'center', minHeight: MinimumTouchTarget },
  inline: { alignItems: 'center', flexDirection: 'row', gap: Spacing.x3, minHeight: MinimumTouchTarget },
  flex: { flex: 1 },
  touch: { minHeight: MinimumTouchTarget },
});
