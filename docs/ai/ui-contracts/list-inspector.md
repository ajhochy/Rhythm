# List and inspector contract

Agents → Tasks is the reference: compact title and one metadata line on the left,
selected item details and actions on the right. Import the shared primitive from
`apps/web/src/components/ListInspector.tsx`; its co-located CSS imports automatically.
Keep domain loading, permissions, confirmation dialogs, requests, and actions in
the adopting page.

## API

```tsx
export type ListInspectorItem = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: string;
  group?: string;
  disabled?: boolean;
};

export function ListInspector(props: {
  label: string;
  items: ListInspectorItem[];
  groups?: { id: string; label: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  toolbar?: React.ReactNode;
  inspector: (item: ListInspectorItem | null) => React.ReactNode;
  emptyState?: React.ReactNode;
  loading?: boolean;
  error?: React.ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
  listWidth?: number;
  listFooter?: React.ReactNode;
});

export function useSelectedId(key: string): [string | null, (id: string | null) => void];
```

Use stable, unique item IDs and unique group IDs. Groups appear in the supplied
order; ungrouped items and items with unknown groups remain visible afterward.
`subtitle` and `meta` share one truncated line; `badge` is optional short text.
Built-in search matches title, subtitle, metadata, and badge without changing
selection. Filtered-out selections retain their inspector because the record still
exists in `items`. Deleted/missing IDs show **Item not found**, with no stale
inspector or actions. Loading takes precedence over error, then normal content;
neither loading nor errors invokes the inspector callback. Empty collections use
`emptyState`; a null selection calls `inspector(null)` for page-specific guidance.

The component owns the selected item's visible `h2` and inspector region. Return
the selected item's details/actions from `inspector`; do not repeat its title in
another heading. Resolve domain data by the callback's item ID, and tolerate null.
Put list-wide actions in `toolbar`, pagination/counts in `listFooter`, and item
actions in the inspector. These slots sit outside the listbox/options.

## Accessibility

- A labeled `role="listbox"` is scrollable and always has `tabIndex={0}`.
- Rows have `role="option"`, exact title accessible names, `aria-selected`, and
  one roving row tab stop. Disabled rows have `aria-disabled` and are skipped.
- ArrowUp/ArrowDown, Home, and End move focus; Enter and Space select. Mouse
  selection focuses the row. Selection and focus are distinct and visibly styled.
- Rows contain text only, never buttons, links, or other interactive descendants.
  Row IDs are also their `data-testid`; prefer the shared title-based helpers.
- The inspector is a focusable region with `aria-labelledby` referencing its
  selected-item heading. Long row titles have a `title` attribute; the full
  inspector heading wraps. Metadata truncates with a text tooltip.
- Rows are at least 52px tall; primary shared controls have at least 44px targets.
  Logical borders/spacing support RTL; focus remains visible in forced colors.
- Existing disabled action fieldsets still disable mutations. Text-only option
  rows and the keyboard-operable Back control allow read-only inspection. The
  Back control uses `role="button"` so it is not disabled by that parent fieldset.
  The primitive never grants write access or executes item actions itself.

## Responsive layout and splitter boundary

At available component widths below **720px**, only one pane is visible. With a
selection, the inspector header offers **Back to list**; going back preserves the
selection and returns focus to its row. Selecting a row returns to the inspector
and focuses its heading. Loading/errors expose the list's status content. Container
queries also handle narrow parent panes and CSS zoom, independently of viewport size.

The root `.list-inspector` accepts `className`. Its grid is
`.list-inspector-panes.tool-split`; panes are `.list-inspector-rail.tool-rail` and
`.list-inspector-detail.tool-detail`. The inspector retains
`data-testid="list-inspector-detail"`. The sole width input is
`--list-inspector-list-width` (default **320px**, list minimum **240px**), optionally
set by `listWidth`. The grid reserves 280px for the inspector and wraps controls.
No drag-resizing is implemented here. A splitter can set that custom property on
the root; omit `listWidth` when a parent supplies the variable.

All multi-pane views must expose their pane boundary to the shared splitter (#1524) once it lands.

## URL selection

`useSelectedId` follows existing hash routes, for example
`#/tools/tasks?scheduleId=schedule-health`. It preserves all other query parameters,
the document URL, and history state; null removes only its key. Selection uses
`history.replaceState` rather than adding a browser history entry per row. Native
hash changes, back/forward navigation, and other hook instances synchronize through
an external-store subscription. Use a page-specific key and retain existing route
parsers/legacy path links in the page adapter. Do not replace an explicit unknown
ID with the first item. An initial null ID may default to the first item if that is
the page's existing behavior.

The schedules adapters retain raw domain IDs in `scheduleId`, prefixing only row
IDs with `schedule-` to preserve existing `schedule-${task.id}` test IDs. Both the
fixture and live renderers use this primitive; canonical live gateway calls,
confirmation dialogs, and action test IDs remain in `ToolWorkspace.tsx`. Live
run-history responses are bound to their schedule/request so late results cannot
appear under a different selection.

## How to adopt on a page (10 lines)

```tsx
import { ListInspector, useSelectedId } from './ListInspector';
function RecordsPage() {
  const records = useRecords(); // Existing page-owned data and permissions.
  const [selectedId, onSelect] = useSelectedId('recordId');
  const items = records.map(record => ({ id: record.id, title: record.name }));
  return <ListInspector label="Records" items={items}
    selectedId={selectedId} onSelect={onSelect} searchable
    inspector={item => item ? <RecordDetails id={item.id} /> : <p>Select a record.</p>}
    emptyState={<p>No records yet.</p>} />;
}
```

Use `tests/helpers/list-inspector.ts` for `selectRow`, `expectSelected`,
`expectInspectorHeading`, `keyboardSelect`, `expectListInspectorAxeClean`,
`atZoom200`, and `atNarrow`. The fixture reference spec is
`tests/list-inspector-primitive.spec.ts`. Run it with the existing fixture Playwright
configuration; the WS-0 worker writes it but does not launch a server/browser.

## Adoption checklist for the umbrella issue

| Exposed Tools entry | Before WS-0 | After WS-0 / remaining owner |
| --- | --- | --- |
| Tasks | Separate fixture/live split implementations | Both use `ListInspector` |
| Brain | Memory list | Consumer migration pending |
| Deep Research | Project split | Consumer migration pending |
| Webhooks | Action-heavy rows | Consumer migration pending |
| Profiles | Existing profile list/inspector | Preserve arrangement; focused controls work #1523 |
| Skills | Catalog split | Consumer migration pending |
| Playbooks | Catalog split | Consumer migration pending |
| Cookbook | Recipe list | Consumer migration pending |
| Review Queue | Proposal cards/actions | Consumer migration pending |
| Report Card | Score/report split | Consumer migration pending |
| Email | Signal split | Consumer migration pending |
| Gallery | Artifact grid/preview | Consumer migration pending |
| Agent Settings | Configuration list | Consumer migration pending |

Other management routes (#1514–#1519, #1521) consume this same API in their own
workstreams. WS-0 does not claim the umbrella migration or live runtime validation.
