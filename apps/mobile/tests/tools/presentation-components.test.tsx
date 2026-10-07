import { fireEvent, render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { ToolCatalog, type ToolCatalogItem } from '../../components/tools/tool-catalog';
import {
  BrainSearchSurface,
  ConnectionMetadata,
  ProviderModelGroups,
  StatusDecisionSummary,
} from '../../components/tools/tool-detail-primitives';

const catalogItems = [
  ['brain', 'Brain', 'knowledge'],
  ['research', 'Research', 'knowledge'],
  ['review', 'Review Queue', 'knowledge'],
  ['report-card', 'Report Card', 'knowledge'],
  ['schedules', 'Scheduled Jobs', 'automation'],
  ['webhooks', 'Webhooks', 'automation'],
  ['profiles', 'Profiles', 'automation'],
  ['cookbook', 'Cookbook', 'automation'],
  ['email', 'Email', 'automation'],
  ['gallery', 'Gallery', 'automation'],
  ['skills', 'Skills', 'system'],
  ['playbooks', 'Playbooks', 'system'],
  ['mcp', 'MCP', 'system'],
  ['models', 'Providers & Models', 'system'],
].map(([id, title, group]) => ({
  id,
  title,
  group,
  metadata: `${title} metadata`,
  status: id === 'mcp' ? 'Connected' : undefined,
})) as ToolCatalogItem[];

test('slice3-c1: catalog renders all 14 manifest tools in grouped accessible rows', () => {
  // Regression caught: a route extraction drops a tool or returns to an ungrouped card wall.
  const onOpen = jest.fn();
  const screen = render(
    <PaperProvider>
      <ToolCatalog items={catalogItems} onOpen={onOpen} />
    </PaperProvider>,
  );

  expect(screen.getAllByRole('button')).toHaveLength(14);
  expect(screen.getByRole('header', { name: 'Knowledge & review' })).toBeTruthy();
  expect(screen.getByRole('header', { name: 'Automation' })).toBeTruthy();
  expect(screen.getByRole('header', { name: 'System & connections' })).toBeTruthy();
  for (const item of catalogItems) {
    expect(screen.getByRole('button', { name: `${item.title}. ${item.metadata}${item.status ? `. ${item.status}` : ''}` })).toBeTruthy();
  }
  fireEvent.press(screen.getByRole('button', { name: 'Brain. Brain metadata' }));
  expect(onOpen).toHaveBeenCalledWith('brain');
});

test('slice3-c2: detail primitives expose search, decisions, connection metadata, and grouped models', () => {
  // Regression caught: generic extraction collapses distinct runtime states into one ambiguous status.
  const onSearchChange = jest.fn();
  const onSearch = jest.fn();
  const onModelPress = jest.fn();
  const screen = render(
    <PaperProvider>
      <BrainSearchSurface
        query="memory"
        onQueryChange={onSearchChange}
        onSearch={onSearch}
      >
        <>Brain results</>
      </BrainSearchSurface>
      <StatusDecisionSummary
        status="Pending review"
        summary="Proposal changes agent scope"
        nextDecision="Approve or reject"
      />
      <ConnectionMetadata
        reachability="Reachable"
        authentication="Signed in"
        enablement="Enabled"
        configuration="3 tools"
      />
      <ProviderModelGroups
        groups={[{
          id: 'anthropic',
          title: 'Anthropic',
          metadata: 'Authenticated',
          models: [{ id: 'claude-a-very-long-model-id-that-must-wrap' }],
        }]}
        onModelPress={onModelPress}
      />
    </PaperProvider>,
  );

  fireEvent.changeText(screen.getByRole('search', { name: 'Search Brain' }), 'shared memory');
  fireEvent.press(screen.getByRole('button', { name: 'Search Brain' }));
  fireEvent.press(screen.getByRole('button', { name: 'Clear Brain search' }));
  expect(onSearchChange).toHaveBeenCalledWith('shared memory');
  expect(onSearchChange).toHaveBeenCalledWith('');
  expect(onSearch).toHaveBeenCalled();
  expect(screen.getByText('Pending review')).toBeTruthy();
  expect(screen.getByText('Approve or reject')).toBeTruthy();
  expect(screen.getByText('Reachability')).toBeTruthy();
  expect(screen.getByText('Authentication')).toBeTruthy();
  expect(screen.getByText('Enablement')).toBeTruthy();
  expect(screen.getByText('Configuration')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Open model claude-a-very-long-model-id-that-must-wrap' }));
  expect(onModelPress).toHaveBeenCalledWith('anthropic', 'claude-a-very-long-model-id-that-must-wrap');
});

test('Brain search does not expose a dead clear affordance for an empty query', () => {
  const screen = render(
    <PaperProvider>
      <BrainSearchSurface query="" onQueryChange={jest.fn()} />
    </PaperProvider>,
  );

  expect(screen.queryByRole('button', { name: 'Clear Brain search' })).toBeNull();
});

test('slice3-c5: tool presentation accepts theme changes and keeps wrapping enabled', () => {
  // Regression caught: fixed-width labels clip under dark mode or larger Dynamic Type.
  const screen = render(
    <PaperProvider>
      <ToolCatalog items={catalogItems} onOpen={jest.fn()} colorScheme="dark" />
    </PaperProvider>,
  );
  expect(screen.getByText('Providers & Models').props.numberOfLines).toBeUndefined();
  expect(screen.getByTestId('tool-catalog-scroll').props.horizontal).not.toBe(true);
});

test('slice3-c6: detail primitives remain callback-driven and accept rendered domain data', () => {
  // Regression caught: presentation starts fetching or inventing provider state instead of rendering props.
  const screen = render(
    <PaperProvider>
      <ConnectionMetadata
        reachability="Caller reachability"
        authentication="Caller authentication"
        enablement="Caller enablement"
        configuration="Caller configuration"
      />
    </PaperProvider>,
  );
  expect(screen.getByText('Caller reachability')).toBeTruthy();
  expect(screen.getByText('Caller authentication')).toBeTruthy();
  expect(screen.getByText('Caller enablement')).toBeTruthy();
  expect(screen.getByText('Caller configuration')).toBeTruthy();
});
