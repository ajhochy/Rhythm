import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, HelperText, RadioButton, Text, TextInput } from 'react-native-paper';

import { Colors, MinimumTouchTarget, Radii, Spacing } from '@/constants/theme';
import type { ProviderAuthMethod } from '@/providers/opencode-provider';

type Palette = typeof Colors.light;

type ProviderConfigDialogProps = {
  authValues: Record<string, string>;
  effectiveAuthMethods: ProviderAuthMethod[];
  isConfiguringProvider: boolean;
  onAuthValueChange: (key: string, value: string) => void;
  onDismiss: () => void;
  onMethodChange: (index: number) => void;
  onSubmit: () => void;
  palette: Palette;
  providerDialogError?: string;
  selectedMethod?: ProviderAuthMethod;
  selectedMethodIndex: number;
  selectedProviderDescription?: string;
  selectedProviderLabel: string;
  visiblePrompts: NonNullable<ProviderAuthMethod['prompts']>;
};

export function ProviderConfigDialog({
  authValues,
  effectiveAuthMethods,
  isConfiguringProvider,
  onAuthValueChange,
  onDismiss,
  onMethodChange,
  onSubmit,
  palette,
  providerDialogError,
  selectedMethod,
  selectedMethodIndex,
  selectedProviderDescription,
  selectedProviderLabel,
  visiblePrompts,
}: ProviderConfigDialogProps) {
  return (
    <Dialog visible onDismiss={onDismiss} style={styles.dialog}>
      <Dialog.Title style={styles.dialogTitle}>{`Configure ${selectedProviderLabel}`}</Dialog.Title>
      <Dialog.ScrollArea style={styles.scrollArea}>
        <ScrollView accessibilityViewIsModal contentContainerStyle={styles.dialogContent} keyboardShouldPersistTaps="handled">
        {selectedProviderDescription ? (
          <Text variant="bodyMedium" style={{ color: palette.muted }}>
            {selectedProviderDescription}
          </Text>
        ) : null}
        {effectiveAuthMethods.length > 1 ? (
          <RadioButton.Group onValueChange={(value) => onMethodChange(Number(value))} value={String(selectedMethodIndex)}>
            {effectiveAuthMethods.map((method, index) => (
              <View accessibilityLabel={method.label} accessibilityRole="radio" accessibilityState={{ checked: selectedMethodIndex === index }} key={`${method.label}-${index}`} style={styles.authMethodRow}>
                <RadioButton value={String(index)} />
                <Text style={{ color: palette.text }}>{method.label}</Text>
              </View>
            ))}
          </RadioButton.Group>
        ) : null}

        {visiblePrompts.map((prompt: NonNullable<ProviderAuthMethod['prompts']>[number]) =>
          prompt.type === 'select' ? (
            <View key={prompt.key} style={styles.promptGroup}>
              <Text variant="labelLarge" style={{ color: palette.text }}>
                {prompt.message}
              </Text>
              <View style={styles.chipWrap}>
                {(prompt.options || []).map((option: NonNullable<typeof prompt.options>[number]) => (
                  <Chip
                    accessibilityRole="radio"
                    accessibilityState={{ checked: authValues[prompt.key] === option.value }}
                    key={option.value}
                    selected={authValues[prompt.key] === option.value}
                    onPress={() => onAuthValueChange(prompt.key, option.value)}>
                    {option.label}
                  </Chip>
                ))}
              </View>
            </View>
          ) : (
            <TextInput
              key={prompt.key}
              mode="outlined"
              label={prompt.message}
              placeholder={prompt.placeholder}
              value={authValues[prompt.key] || ''}
              onChangeText={(value) => onAuthValueChange(prompt.key, value)}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={/token|key|secret|password/i.test(prompt.key)}
            />
          ),
        )}

        {selectedMethod?.type === 'oauth' ? (
          <HelperText type="info">This opens the provider sign-in flow in your browser.</HelperText>
        ) : null}
        {!selectedMethod && effectiveAuthMethods.length === 0 ? (
          <HelperText type="error">Setup details for this provider are unavailable right now.</HelperText>
        ) : null}
        {providerDialogError ? <HelperText type="error">{providerDialogError}</HelperText> : null}
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        <Button onPress={onDismiss}>Cancel</Button>
        <Button testID="settings-provider-save-button" disabled={!selectedMethod} loading={isConfiguringProvider} onPress={onSubmit}>
          {selectedMethod?.type === 'oauth' ? 'Continue' : 'Save'}
        </Button>
      </Dialog.Actions>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  dialog: { borderRadius: Radii.sheet, marginHorizontal: Spacing.x6 },
  dialogTitle: { paddingTop: Spacing.x6 },
  dialogContent: { gap: Spacing.x4, paddingVertical: Spacing.x2 },
  scrollArea: { maxHeight: '70%', paddingHorizontal: Spacing.x6 },
  authMethodRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.x2, minHeight: MinimumTouchTarget },
  promptGroup: { gap: Spacing.x2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.x2 },
});
