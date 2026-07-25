import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Avatar, Card, Text } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  TOOL_SCREEN_MANIFEST,
  type ToolScreenId,
} from '@/providers/services/rhythm-tools-service';

const TOOL_COPY: Record<ToolScreenId, { description: string; icon: string }> = {
  brain: { description: 'Search and maintain agent memory', icon: 'brain' },
  research: { description: 'Start, follow, and review deep research', icon: 'book-search-outline' },
  schedules: { description: 'Create jobs and run them on demand', icon: 'calendar-clock' },
  webhooks: { description: 'Secure inbound automation endpoints', icon: 'webhook' },
  profiles: { description: 'Agent prompts, models, scope, and delegation', icon: 'account-cog-outline' },
  cookbook: { description: 'Reusable, profile-bound agent recipes', icon: 'book-open-variant' },
  review: { description: 'Approve or reject optimizer proposals', icon: 'clipboard-check-outline' },
  'report-card': { description: 'Completion, escalation, and quality trends', icon: 'chart-box-outline' },
  email: { description: 'Cloud email signals, even while Mac is offline', icon: 'email-outline' },
  gallery: { description: 'Cloud design previews and generated assets', icon: 'image-multiple-outline' },
  skills: { description: 'View and author approved agent skills', icon: 'lightning-bolt-outline' },
  playbooks: { description: 'Manage reusable slash-command workflows', icon: 'script-text-outline' },
  mcp: { description: 'Connect and inspect MCP servers', icon: 'connection' },
  models: { description: 'Providers, authentication, and model availability', icon: 'cpu-64-bit' },
};

export default function ToolsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <Appbar.Header
        elevated={false}
        style={{ backgroundColor: palette.background }}>
        <Appbar.Content
          title="Tools"
          titleStyle={{ color: palette.text }}
        />
      </Appbar.Header>
      <ScrollView
        accessibilityLabel="Agent tools"
        contentContainerStyle={styles.content}>
        <Text style={{ color: palette.muted }} variant="bodyLarge">
          Work with Rhythm’s knowledge, automation, operations, and connection
          tools through your paired Mac.
        </Text>
        {TOOL_SCREEN_MANIFEST.map((tool) => {
          const copy = TOOL_COPY[tool.id];
          return (
          <Card
            accessibilityLabel={`${tool.title}. ${copy.description}`}
            accessibilityRole="button"
            key={tool.id}
            mode="outlined"
            onPress={() => router.push(tool.route as never)}
            style={[styles.card, { borderColor: palette.border }]}>
            <Card.Title
              left={(props) => <Avatar.Icon {...props} icon={copy.icon} />}
              subtitle={copy.description}
              subtitleNumberOfLines={3}
              title={tool.title}
            />
          </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 14, padding: 16, paddingBottom: 32 },
  card: { borderRadius: 16 },
});
