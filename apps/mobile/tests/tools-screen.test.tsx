import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import ToolsScreen from '@/app/(tabs)/tools';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const { View: NativeView } = jest.requireActual('react-native');

  return {
    ...actual,
    SafeAreaView: ({ children, edges, style }: {
      children: React.ReactNode;
      edges: string[];
      style: unknown;
    }) => (
      <NativeView
        style={[
          style,
          { paddingTop: edges.includes('top') ? 47 : 0 },
        ]}
        testID="tools-safe-area">
        {children}
      </NativeView>
    ),
  };
});

test('Tools keeps its title below a nonzero top safe-area inset', () => {
  const screen = render(
    <PaperProvider>
      <ToolsScreen />
    </PaperProvider>,
  );

  expect(screen.getByRole('header', { name: 'Tools' })).toBeTruthy();
  expect(
    StyleSheet.flatten(screen.getByTestId('tools-safe-area').props.style),
  ).toMatchObject({ paddingTop: 47 });
});
