import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  ActionSheetIOS,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type NativeSelectOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  sectionLabel?: string;
  leadingIcon?: (props: { size: number; color: string; selected: boolean }) => ReactNode;
};

type NativeSelectProps<T extends string> = {
  disabled?: boolean;
  onValueChange: (value: T) => void;
  options: NativeSelectOption<T>[];
  renderTrigger: (props: {
    disabled: boolean;
    open: () => void;
    openState: boolean;
    selectedOption?: NativeSelectOption<T>;
  }) => ReactNode;
  selectedValue?: T;
  title?: string;
};

export function NativeSelect<T extends string>({
  disabled = false,
  onValueChange,
  options,
  renderTrigger,
  selectedValue,
  title,
}: NativeSelectProps<T>) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [visible, setVisible] = useState(false);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === selectedValue),
    [options, selectedValue],
  );

  const close = useCallback(() => setVisible(false), []);

  const handleSelect = useCallback(
    (value: T) => {
      setVisible(false);
      onValueChange(value);
    },
    [onValueChange],
  );

  const open = useCallback(() => {
    if (disabled || options.length === 0) {
      return;
    }

    if (Platform.OS === 'ios' && !options.some((option) => option.sectionLabel)) {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          cancelButtonIndex: options.length,
          options: [...options.map((option) => option.label), 'Cancel'],
          title,
          userInterfaceStyle: colorScheme,
        },
        (buttonIndex) => {
          if (buttonIndex >= 0 && buttonIndex < options.length) {
            onValueChange(options[buttonIndex].value);
          }
        },
      );
      return;
    }

    setVisible(true);
  }, [colorScheme, disabled, onValueChange, options, title]);

  return (
    <>
      {renderTrigger({
        disabled: disabled || options.length === 0,
        open,
        openState: visible,
        selectedOption,
      })}
      {Platform.OS === 'ios' && !options.some((option) => option.sectionLabel) ? null : (
        <Modal animationType="fade" transparent visible={visible} onRequestClose={close}>
          <View style={styles.overlay}>
            <Pressable style={styles.backdrop} onPress={close} />
            <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={[styles.sheetHeader, { borderBottomColor: palette.border }]}>
                <Text numberOfLines={1} style={[styles.sheetTitle, { color: palette.text }]}>
                  {title || 'Choose an option'}
                </Text>
                <Pressable onPress={close} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                  <Text style={[styles.closeButtonLabel, { color: palette.tint }]}>Close</Text>
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.optionList} keyboardShouldPersistTaps="handled">
                {options.map((option, index) => {
                  const selected = option.value === selectedValue;
                  const color = selected ? palette.tint : palette.muted;
                  const showSection = option.sectionLabel && (
                    index === 0 || options[index - 1]?.sectionLabel !== option.sectionLabel
                  );

                  return (
                    <View key={option.value}>
                      {showSection ? (
                        <Text accessibilityRole="header" style={[styles.sectionLabel, { color: palette.muted }]}>
                          {option.sectionLabel}
                        </Text>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => handleSelect(option.value)}
                        style={({ pressed }) => [
                          styles.option,
                          {
                            backgroundColor: selected ? palette.background : palette.surface,
                            borderColor: selected ? palette.tint : palette.border,
                          },
                          pressed && styles.pressed,
                        ]}>
                        <View style={styles.optionBody}>
                          {option.leadingIcon ? (
                            <View style={[styles.optionIcon, { backgroundColor: `${color}14` }]}>
                              {option.leadingIcon({ color, selected, size: 18 })}
                            </View>
                          ) : null}
                          <View style={styles.optionTextWrap}>
                            <Text style={[styles.optionLabel, { color: palette.text }]}>{option.label}</Text>
                            {option.description ? (
                              <Text style={[styles.optionDescription, { color: palette.muted }]}>{option.description}</Text>
                            ) : null}
                          </View>
                          {selected ? <MaterialCommunityIcons name="check" size={20} color={palette.tint} /> : null}
                        </View>
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    maxHeight: '72%',
    overflow: 'hidden',
  },
  sheetHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sheetTitle: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    borderRadius: 999,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  closeButtonLabel: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    fontWeight: '600',
  },
  optionList: {
    gap: 8,
    padding: 12,
    paddingBottom: 24,
  },
  option: {
    borderRadius: 16,
    borderWidth: 1,
  },
  sectionLabel: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    paddingHorizontal: 4,
    paddingBottom: 6,
    paddingTop: 10,
    textTransform: 'uppercase',
  },
  optionBody: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  optionIcon: {
    alignItems: 'center',
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  optionTextWrap: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  optionLabel: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    fontWeight: '600',
  },
  optionDescription: {
    fontFamily: Fonts.sans,
    fontSize: 13,
  },
  pressed: {
    opacity: 0.82,
  },
});
