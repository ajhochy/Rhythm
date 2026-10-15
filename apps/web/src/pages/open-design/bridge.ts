export type OpenDesignStatus = { state: 'ready' } | { state: 'unavailable'; code: 'unavailable' };
// No attachment nonce: preload keeps it private and never returns it to the renderer.
export type OpenDesignAttachResult = { ok: boolean; reason?: string };
export type OpenDesignShell = {
  openDesignView?: {
    getStatus(): Promise<OpenDesignStatus | void>;
    attach(): Promise<OpenDesignAttachResult | void>;
    setBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<boolean | void>;
    detach(): Promise<boolean | void>;
  };
};

// Local intersection avoids extending Window globally while the shared preload
// owner adds the real rhythmShell type and bridge hook.
export function openDesignShell() {
  return (window as Window & { rhythmShell?: OpenDesignShell }).rhythmShell;
}
