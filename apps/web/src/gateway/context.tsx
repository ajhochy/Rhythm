import { createContext, useContext, useEffect, useState } from 'react';
import type { GatewayService, RendererGateway } from '.';

const GatewayContext = createContext<RendererGateway | null>(null);

export function GatewayProvider({ gateway, children }: { gateway: RendererGateway; children: React.ReactNode }) {
  return <GatewayContext.Provider value={gateway}>{children}</GatewayContext.Provider>;
}

export function useGateway() {
  const gateway = useContext(GatewayContext);
  if (!gateway) throw new Error('useGateway must be used within GatewayProvider');
  return gateway;
}

type ReceiptState = 'checking' | 'healthy' | 'error';

export function EnvironmentReceipt() {
  const gateway = useGateway();
  const [health, setHealth] = useState<Record<GatewayService, ReceiptState>>({ api: 'checking', engine: 'checking' });

  useEffect(() => {
    if (gateway.mode === 'fixture') return;
    let active = true;
    const settle = async () => {
      // Auth/profile writes intentionally restart the supervised engine twice:
      // once for the direct reload and once for the credential watcher. Do not
      // advertise the environment as Live while that debounce window is open.
      await new Promise((resolve) => window.setTimeout(resolve, 3_000));
      for (let attempt = 0; attempt < 8 && active; attempt += 1) {
        try {
          await Promise.all([gateway.health.api(), gateway.health.engine()]);
          if (active) setHealth({ api: 'healthy', engine: 'healthy' });
          return;
        } catch {
          if (active) setHealth({ api: 'checking', engine: 'checking' });
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
      }
      if (active) setHealth({ api: 'error', engine: 'error' });
    };
    void settle();
    return () => { active = false; };
  }, [gateway]);

  const text = gateway.mode === 'fixture'
    ? 'Environment: Fixture · deterministic local data · no network'
    : health.api === 'healthy' && health.engine === 'healthy'
      ? 'Environment: Live · API :4098 healthy · Engine :4097 healthy'
      : `Environment: Connecting · API :4098 ${health.api} · Engine :4097 ${health.engine}`;

  return (
    <div
      role="status"
      aria-label="Environment receipt"
      data-testid="environment-receipt"
      style={{ position: 'fixed', zIndex: 100, left: '50%', top: 4, transform: 'translateX(-50%)', padding: '2px 10px', border: '1px solid var(--border)', borderRadius: 999, color: 'var(--fg)', background: 'var(--surface-raised)', font: '600 10px var(--font-mono)', whiteSpace: 'nowrap' }}
    >
      {text}
    </div>
  );
}
