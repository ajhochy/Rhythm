import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ToolCatalog,
  type ToolCatalogGroup,
} from '@/components/tools/tool-catalog';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  TOOL_SCREEN_MANIFEST,
  type ToolScreenId,
} from '@/providers/services/rhythm-tools-service';

const TOOL_COPY: Record<ToolScreenId, { description: string; group: ToolCatalogGroup }> = {
  brain: { description: 'Search and maintain agent memory', group: 'knowledge' },
  research: { description: 'Start, follow, and review deep research', group: 'knowledge' },
  schedules: { description: 'Create jobs and run them on demand', group: 'automation' },
  webhooks: { description: 'Secure inbound automation endpoints', group: 'automation' },
  profiles: { description: 'Agent prompts, models, scope, and delegation', group: 'automation' },
  cookbook: { description: 'Reusable, profile-bound agent recipes', group: 'automation' },
  review: { description: 'Approve or reject optimizer proposals', group: 'knowledge' },
  'report-card': { description: 'Completion, escalation, and quality trends', group: 'knowledge' },
  email: { description: 'Cloud email signals, even while Mac is offline', group: 'automation' },
  gallery: { description: 'Cloud design previews and generated assets', group: 'automation' },
  skills: { description: 'View and author approved agent skills', group: 'system' },
  playbooks: { description: 'Manage reusable slash-command workflows', group: 'system' },
  mcp: { description: 'Connect and inspect MCP servers', group: 'system' },
  models: { description: 'Providers, authentication, and model availability', group: 'system' },
};

const TOOL_CATALOG_ITEMS = TOOL_SCREEN_MANIFEST.map((tool) => ({
  id: tool.id,
  title: tool.title,
  group: TOOL_COPY[tool.id].group,
  metadata: TOOL_COPY[tool.id].description,
}));

export default function ToolsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.largeTitle, { color: palette.text }]}>Tools</Text>
        <Text style={{ color: palette.muted }} variant="bodyLarge">
          Work with Rhythm’s knowledge, automation, operations, and connection
          tools through your paired Mac.
        </Text>
      </View>
      <ToolCatalog
        items={TOOL_CATALOG_ITEMS}
        onOpen={(id) => {
          const destination = TOOL_SCREEN_MANIFEST.find((tool) => tool.id === id);
          if (destination) router.push(destination.route as never);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { gap: 8, paddingHorizontal: 16, paddingTop: 16 },
  largeTitle: { fontSize: 34, fontWeight: '700', lineHeight: 41 },
});
