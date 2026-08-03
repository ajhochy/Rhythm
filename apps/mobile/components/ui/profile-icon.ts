import { MaterialCommunityIcons } from '@expo/vector-icons';
import materialCommunityGlyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json';
import type { ComponentProps } from 'react';

export type ProfileIconName = ComponentProps<
  typeof MaterialCommunityIcons
>['name'];

const PROFILE_ICON_ALIASES: Record<string, ProfileIconName> = {
  'settings-suggest': 'cog-outline',
  '🩺': 'stethoscope',
};

const DESKTOP_ASSET_PATH = /(?:^|\/)(?:assets?|images?)\/|\.(?:gif|jpe?g|png|svg|webp)$/i;

export function normalizeProfileIcon(icon: unknown): ProfileIconName {
  if (typeof icon !== 'string') return 'account-outline';
  const token = icon.trim();
  if (!token) return 'account-outline';
  if (PROFILE_ICON_ALIASES[token]) return PROFILE_ICON_ALIASES[token];
  if (DESKTOP_ASSET_PATH.test(token)) return 'robot-outline';
  if (Object.prototype.hasOwnProperty.call(materialCommunityGlyphs, token)) {
    return token as ProfileIconName;
  }
  return 'account-outline';
}
