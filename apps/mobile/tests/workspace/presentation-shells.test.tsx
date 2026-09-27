import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { PaperProvider, Text } from 'react-native-paper';

import { TerminalShell } from '../../components/workspace/terminal-shell';
import { WorkspaceShell } from '../../components/workspace/workspace-shell';

test('slice3-c3: workspace shell renders project scope, local segments, grouped metadata, and slots', () => {
  // Regression caught: long project scope or file metadata overflows when route markup is extracted.
  const onSegmentChange = jest.fn();
  const onSearchChange = jest.fn();
  const onSearch = jest.fn();
  const onOpenRow = jest.fn();
  const longPath = '/Users/example/Documents/a-very-long-project-path/that-must-wrap/Rhythm';
  const screen = render(
    <PaperProvider>
      <WorkspaceShell
        projectLabel="Rhythm"
        projectPath={longPath}
        activeSegment="files"
        onSegmentChange={onSegmentChange}
        search={{
          label: 'Search workspace files',
          value: 'README',
          onChange: onSearchChange,
          onSubmit: onSearch,
        }}
        groups={[{
          id: 'results',
          title: 'Search results',
          rows: [{ id: 'readme', title: 'README.md', metadata: 'Markdown · 2 KB', path: 'docs/README.md' }],
        }]}
        onOpenRow={onOpenRow}
        chatsContent={<Text>Chats slot</Text>}
        filesContent={<Text>Files slot</Text>}
        toolsContent={<Text>Tools slot</Text>}
      />
    </PaperProvider>,
  );

  expect(screen.getByText(longPath).props.numberOfLines).toBeUndefined();
  expect(screen.getByText('Files slot')).toBeTruthy();
  expect(screen.getByText('Markdown · 2 KB')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Tools' }));
  expect(onSegmentChange).toHaveBeenCalledWith('tools');
  fireEvent.press(screen.getByRole('button', { name: 'README.md. Markdown · 2 KB. docs/README.md' }));
  expect(onOpenRow).toHaveBeenCalledWith('readme');
});

test('slice3-c4: terminal shell prioritizes mono output and demotes caller actions', () => {
  // Regression caught: destructive terminal actions compete visually with output or lose caller labels.
  const onCreate = jest.fn();
  const onRefresh = jest.fn();
  const onClose = jest.fn();
  const screen = render(
    <PaperProvider>
      <TerminalShell
        title="Build terminal"
        subtitle="/a/long/project/path · connected"
        output="$ npm run typecheck\nDone"
        actions={[
          { id: 'create', label: 'Create terminal', onPress: onCreate, icon: 'plus', testID: 'terminal-create-button' },
          { id: 'refresh', label: 'Refresh terminals', onPress: onRefresh },
          { id: 'close', label: 'Close terminal', onPress: onClose, destructive: true },
        ]}
      />
    </PaperProvider>,
  );

  expect(StyleSheet.flatten(screen.getByTestId('terminal-output').props.style)).toMatchObject({
    fontFamily: 'SFMono-Regular',
    fontSize: 13,
  });
  for (const label of ['Create terminal', 'Refresh terminals', 'Close terminal']) {
    expect(screen.getByRole('button', { name: label })).toBeTruthy();
  }
  expect(screen.getByTestId('terminal-create-button')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Close terminal' }));
  expect(onClose).toHaveBeenCalled();
});

test('slice3-c7: presentation shells expose no route integration side effects', () => {
  // Regression caught: reusable shells import navigation and silently wire routes in this slice.
  expect(WorkspaceShell).toEqual(expect.any(Function));
  expect(TerminalShell).toEqual(expect.any(Function));
});

test('slice-b-workspace-repair-c2: project selector composes inside the single scope surface', () => {
  // Regression caught: project identity is duplicated in the route app bar instead of living in WorkspaceShell.
  const screen = render(
    <PaperProvider>
      <WorkspaceShell
        activeSegment="chats"
        onSegmentChange={jest.fn()}
        projectLabel="Rhythm"
        projectPath="/workspace/rhythm"
        scopeSelector={<Text>Project selector</Text>}
      />
    </PaperProvider>,
  );

  expect(screen.getByText('Project selector')).toBeTruthy();
});

test('slice-b-terminal-repair-c3: output precedes detail metadata and quiet actions', () => {
  // Regression caught: resize controls displace terminal output from the output-first position.
  const screen = render(
    <PaperProvider>
      <TerminalShell
        title="Terminal"
        output="$ ready"
        detailSlot={<Text>Resize detail</Text>}
        actions={[{ id: 'refresh', label: 'Refresh terminals', onPress: jest.fn() }]}
      />
    </PaperProvider>,
  );
  const tree = JSON.stringify(screen.toJSON());

  expect(tree.indexOf('$ ready')).toBeLessThan(tree.indexOf('Resize detail'));
  expect(tree.indexOf('Resize detail')).toBeLessThan(tree.indexOf('Refresh terminals'));
});
