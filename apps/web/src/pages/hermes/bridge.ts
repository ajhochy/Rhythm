export type HermesStatus = {
  state: 'disabled' | 'absent' | 'starting' | 'ready' | 'failed' | 'stopped';
  port?: number;
  url?: string;
  reason?: string;
  version?: string;
};
export type HermesIntent = { v: 1; type: 'new-chat'; context: string } | { v: 1; type: 'navigate-session'; sessionId: string };
export type HermesResult = { ok: boolean; reason?: string };
// issue-1570-e: version/source/fallbackReason let the page state which Hermes Desktop artifact
// attached and why, when an installed update failed validation/import and Rhythm fell back to the
// bundled copy (see resolveHermesDesktopArtifact + createHermesDesktopUpdateStore).
export type HermesAttachResult = HermesResult & {
  version?: string;
  source?: 'installed' | 'factory';
  fallbackReason?: string;
};
export type HermesInstallResult = { ok: boolean; reason?: string; cancelled?: boolean; version?: string };
export type HermesShell = {
  hermes?: {
    enabled: boolean;
    getStatus(): Promise<HermesStatus>;
    install(): Promise<HermesStatus>;
    restart(): Promise<HermesStatus>;
    onStatus(callback: (status: HermesStatus) => void): () => void;
  };
  hermesView?: {
    attach(): Promise<HermesAttachResult | void>;
    setBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<boolean | void>;
    detach(): Promise<boolean | void>;
    sendIntent(intent: HermesIntent): Promise<HermesResult | void>;
    // Main-owned native file dialog only; never a renderer-supplied path. A cancelled dialog
    // resolves { ok: false, cancelled: true } and performs no filesystem writes.
    installUpdate(): Promise<HermesInstallResult | void>;
  };
};

// Use a local intersection, matching other Electron consumers. B2 can add its
// types without colliding with a second global Window.rhythmShell declaration.
export function hermesShell() {
  return (window as Window & { rhythmShell?: HermesShell }).rhythmShell;
}

// Dashboard/task counts currently live inside their pages, not in a shared
// store. Do not mistake agent-session todos or fixture totals for dashboard data.
export function dashboardDraftContext(): string {
  return 'Rhythm dashboard summary\nDashboard and task counts are not available in this view.\nPrepared as draft context for review before sending.';
}
