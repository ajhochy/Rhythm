export type ColonySourceChoice = { id: string; state?: 'present' | 'missing'; enabled: boolean };
export type ColonyStatus = { v: 1; available: boolean; enabled: boolean; sources: ColonySourceChoice[]; reason?: string };
export type ColonyShell = {
  colonyView?: {
    getStatus(): Promise<ColonyStatus>;
    discoverSources(): Promise<ColonySourceChoice[]>;
    setEnabled(enabled: boolean): Promise<ColonyStatus>;
    setSource(id: string, enabled: boolean): Promise<ColonyStatus>;
    attach(): Promise<{ ok: boolean; reason?: string } | void>;
    setBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<boolean | void>;
    inventoryPage(page: { generation?: string; cursor?: string; collection?: 'threads' | 'projects' | 'warnings'; limit?: number }): Promise<{ generation: string; collection: 'threads' | 'projects' | 'warnings'; scannedAt: number; records: unknown[]; nextCursor: string | null }>;
    inventoryCancel(generation: string): Promise<boolean | void>;
    runAction(kind: 'open' | 'showParent' | 'reveal' | 'copyPath' | 'archive' | 'restore' | 'viewed', id: string): Promise<{ ok: boolean; kind?: string; id?: string; sessionId?: string; reason?: string }>;
    previewImport(): Promise<{ ok: boolean; cancelled?: boolean; counts?: { archived: number; viewed: number; groups: number; version?: number }; reason?: string }>;
    commitImport(): Promise<{ ok: boolean; receipt?: { updatedAt: number; counts: { archived: number; viewed: number; groups: number } }; reason?: string }>;
    onReset?(callback: () => void): () => void;
    sendIntent(intent: { event: 'host.select' | 'host.filter' | 'host.view' | 'host.visibility'; payload: Record<string, unknown> }): void;
    onEvent(callback: (message: { event: 'scene.select' | 'scene.status'; payload: Record<string, unknown> }) => void): () => void;
    detach(): Promise<boolean | void>;
  };
};

export function colonyShell() {
  return (window as Window & { rhythmShell?: ColonyShell }).rhythmShell;
}
