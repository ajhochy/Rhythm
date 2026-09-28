import { useState, type DragEvent, type FormEvent } from 'react';
import type { AgentDesign, AgentDesignFolder } from '../../gateway/designs';
import { Icon } from '../../icons';
import { LIST_ITEM_DRAG_TYPE } from '../ListInspector';

/** 'all' | 'unfiled' | a folder id. */
export type GalleryFilter = string;
export const matchesGalleryFilter = (design: AgentDesign, filter: GalleryFilter) =>
  filter === 'all' || (filter === 'unfiled' ? !design.folderId : design.folderId === filter);

/**
 * Single-level folder column for the Creative Media gallery. Design rows are dropped here
 * (HTML5 drag and drop, payload = design id); "Unfiled" is a drop target that clears the folder.
 * ponytail: no nesting yet — folders are one level deep.
 */
export function GalleryFolders({ folders, designs, filter, onFilter, onCreate, onRename, onRequestDelete, onMove }: {
  folders: AgentDesignFolder[];
  designs: AgentDesign[];
  filter: GalleryFilter;
  onFilter(filter: GalleryFilter): void;
  onCreate(name: string): Promise<void>;
  onRename(folder: AgentDesignFolder, name: string): Promise<void>;
  onRequestDelete(folder: AgentDesignFolder): void;
  onMove(designId: string, folderId: string | null): void;
}) {
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const count = (key: GalleryFilter) => designs.filter((design) => matchesGalleryFilter(design, key)).length;

  const dropProps = (key: string, folderId: string | null) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(LIST_ITEM_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDropTarget(null);
      const designId = event.dataTransfer.getData(LIST_ITEM_DRAG_TYPE);
      if (designId) onMove(designId, folderId);
    },
  });

  const submitName = (commit: (name: string) => Promise<void>, done: () => void) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitted) return; // Enter then blur must not submit twice.
    form.dataset.submitted = '1';
    const name = String(new FormData(form).get('name') ?? '').trim();
    done();
    if (name) void commit(name).catch(() => undefined);
  };
  const nameField = (label: string, initial: string, testId: string, onCancel: () => void) => (
    <input name="name" aria-label={label} defaultValue={initial} autoFocus maxLength={200} data-testid={testId}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }}
      onBlur={(event) => event.currentTarget.form?.requestSubmit()} />
  );

  const row = (key: GalleryFilter, label: string, folder?: AgentDesignFolder) => (
    <li key={key} className={`gallery-folder${filter === key ? ' selected' : ''}${dropTarget === key ? ' drop-target' : ''}`}
      data-testid={`gallery-folder-${key}`} {...(key === 'all' ? {} : dropProps(key, folder ? folder.id : null))}>
      {folder && renamingId === folder.id
        ? <form onSubmit={submitName((name) => onRename(folder, name), () => setRenamingId(null))}>{nameField(`Rename folder ${folder.name}`, folder.name, 'gallery-folder-rename-input', () => setRenamingId(null))}</form>
        : <button type="button" className="gallery-folder-select" aria-current={filter === key ? 'true' : undefined}
            onClick={() => onFilter(key)} onDoubleClick={folder ? () => setRenamingId(folder.id) : undefined}>
            <Icon name={folder ? 'archive' : key === 'all' ? 'gallery' : 'file'} size={14} />
            <span className="gallery-folder-name" title={label}>{label}</span>
            <span className="gallery-folder-count" aria-label={`${count(key)} items`}>{count(key)}</span>
          </button>}
      {folder && renamingId !== folder.id && <details className="gallery-folder-menu">
        <summary aria-label={`Folder actions for ${folder.name}`} data-testid={`gallery-folder-menu-${folder.id}`}><Icon name="more" size={14} /></summary>
        <div className="gallery-folder-menu-items">
          <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setRenamingId(folder.id); }} data-testid={`gallery-folder-rename-${folder.id}`}><Icon name="rename" size={14} />Rename</button>
          <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onRequestDelete(folder); }} data-testid={`gallery-folder-delete-${folder.id}`}><Icon name="delete" size={14} />Delete</button>
        </div>
      </details>}
    </li>
  );

  return <nav className="gallery-folders" aria-label="Gallery folders" data-testid="gallery-folders">
    <ul>
      {row('all', 'All')}
      {row('unfiled', 'Unfiled')}
      {folders.map((folder) => row(folder.id, folder.name, folder))}
    </ul>
    {creating
      ? <form className="gallery-folder-new" onSubmit={submitName(onCreate, () => setCreating(false))}>{nameField('New folder name', '', 'gallery-folder-new-input', () => setCreating(false))}</form>
      : <button type="button" className="secondary-button compact" onClick={() => setCreating(true)} data-testid="gallery-folder-new"><Icon name="plus" size={14} />New folder</button>}
  </nav>;
}
