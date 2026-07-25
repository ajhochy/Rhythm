import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Avatar, Card, Text } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const TOOL_GROUPS = [
  {
    title: 'Knowledge',
    description: 'Brain, Research, Profiles, Cookbook, and Skills',
    icon: 'brain',
    route: '/tools/brain',
  },
  {
    title: 'Automation',
    description: 'Scheduled Jobs, Webhooks, and Playbooks',
    icon: 'calendar-clock',
    route: '/tools/schedules',
  },
  {
    title: 'Operations',
    description: 'Review Queue, Report Card, Email, and Gallery',
    icon: 'clipboard-check-outline',
    route: '/tools/review',
  },
  {
    title: 'Connections',
    description: 'MCP Servers and Providers',
    icon: 'connection',
    route: '/tools/mcp',
  },
] as const;

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
        {TOOL_GROUPS.map((group) => (
          <Card
            accessibilityLabel={`${group.title}. ${group.description}`}
            key={group.title}
            mode="outlined"
            onPress={() => router.push(group.route as never)}
            style={[styles.card, { borderColor: palette.border }]}>
            <Card.Title
              left={(props) => <Avatar.Icon {...props} icon={group.icon} />}
              subtitle={group.description}
              subtitleNumberOfLines={3}
              title={group.title}
            />
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 14, padding: 16, paddingBottom: 32 },
  card: { borderRadius: 16 },
});
