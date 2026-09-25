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
    detach(): Promise<boolean | void>;
  };
};

export function colonyShell() {
  return (window as Window & { rhythmShell?: ColonyShell }).rhythmShell;
}
