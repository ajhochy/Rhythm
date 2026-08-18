import { useEffect, useRef, useState } from 'react';
import { useGateway } from '../../gateway/context';
import {
  MobileAccessGatewayError,
  type MobileAccessDiagnostic,
  type MobileAccessState,
  type MobilePairedDevice,
  type MobilePairingOffer,
} from '../../gateway/mobile-access';

type FixtureScenario = MobileAccessState;
type OfferStatus = 'idle' | 'active' | 'expired' | 'consumed';

// Display copy only. The canonical protocol value is `diagnostic.state`
// (apps/api_server/src/services/tailscale_serve_service.ts:8-13) — rendered separately below via
// `data-access-state` so nothing here can be mistaken for the wire value.
const STATE_LABEL: Record<MobileAccessState, string> = {
  missing: 'Tailscale not installed',
  loggedOut: 'Signed out of Tailscale',
  wrongTarget: 'Mobile access not configured',
  healthy: 'Mobile access available',
};

// Real pairing codes expire after five minutes (apps/api_server/src/services/mobile_pairing_service.ts:65).
// The fixture uses a short TTL so a redspec can observe expiry without a five-minute real wait.
const FIXTURE_PAIRING_TTL_MS = 4_000;

function queryParams() {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

function fixtureDiagnostic(scenario: FixtureScenario): MobileAccessDiagnostic {
  const gatewayUrl = 'https://fixture-mac.example.ts.net';
  switch (scenario) {
    case 'missing':
      return { state: 'missing', gatewayUrl: null, message: 'Tailscale is not installed on this Mac.', canConfigure: false };
    case 'loggedOut':
      return { state: 'loggedOut', gatewayUrl: null, message: 'Sign in to Tailscale on this Mac, then try again.', canConfigure: false };
    case 'wrongTarget':
      return { state: 'wrongTarget', gatewayUrl, message: 'Tailscale Serve points somewhere other than Rhythm.', canConfigure: true };
    case 'healthy':
      return { state: 'healthy', gatewayUrl, message: 'Mobile access is available on your private tailnet.', canConfigure: false };
  }
}

let fixtureDeviceSeq = 1;
function seedFixtureDevices(): MobilePairedDevice[] {
  return [{ id: 'fixture-device-seed-1', hostId: 'fixture-host', userId: 1, name: "AJ's iPhone", revokedAt: null, createdAt: '2026-08-10T12:00:00.000Z' }];
}
function newFixtureDevice(): MobilePairedDevice {
  fixtureDeviceSeq += 1;
  return { id: `fixture-device-${fixtureDeviceSeq}`, hostId: 'fixture-host', userId: 1, name: 'New phone', revokedAt: null, createdAt: new Date().toISOString() };
}

const errorMessage = (error: unknown) => error instanceof MobileAccessGatewayError ? error.message : 'Mobile access service unavailable';

export function MobileAccessPage() {
  const gateway = useGateway();
  const isLive = gateway.mode === 'live';
  const liveGateway = gateway.domains.mobileAccess ?? null;
  const scenario = (queryParams().get('scenario') as FixtureScenario | null) ?? 'healthy';

  const [diagnostic, setDiagnostic] = useState<MobileAccessDiagnostic | null>(null);
  const [diagnosing, setDiagnosing] = useState(true);
  const [diagnosticError, setDiagnosticError] = useState('');
  const [enabling, setEnabling] = useState(false);

  const [offer, setOffer] = useState<MobilePairingOffer | null>(null);
  const [offerStatus, setOfferStatus] = useState<OfferStatus>('idle');
  const [generating, setGenerating] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const deviceCountAtOffer = useRef(0);

  const [devices, setDevices] = useState<MobilePairedDevice[]>(() => (isLive ? [] : seedFixtureDevices()));
  const [devicesLoaded, setDevicesLoaded] = useState(!isLive);
  const [devicesError, setDevicesError] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadDiagnostic = async () => {
    setDiagnosing(true);
    setDiagnosticError('');
    if (isLive) {
      if (!liveGateway) { setDiagnosticError('Mobile access gateway is not configured.'); setDiagnosing(false); return; }
      try { setDiagnostic(await liveGateway.diagnose()); }
      catch (error) { setDiagnosticError(errorMessage(error)); }
      finally { setDiagnosing(false); }
      return;
    }
    setDiagnostic(fixtureDiagnostic(scenario));
    setDiagnosing(false);
  };

  const loadDevices = async () => {
    if (!isLive) { setDevicesLoaded(true); return; }
    if (!liveGateway) return;
    try {
      const list = await liveGateway.listDevices();
      setDevices(list);
      setDevicesLoaded(true);
      setDevicesError('');
      setOfferStatus((current) => (current === 'active' && list.length > deviceCountAtOffer.current ? 'consumed' : current));
      if (list.length > deviceCountAtOffer.current) setOffer(null);
    } catch (error) {
      setDevicesError(errorMessage(error));
    }
  };

  useEffect(() => {
    void loadDiagnostic();
    void loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, liveGateway, scenario]);

  // Expiry countdown: the offer clears itself once `expiresAt` passes, independent of any refresh.
  useEffect(() => {
    if (!offer || offerStatus !== 'active') return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining <= 0) { setOffer(null); setOfferStatus('expired'); }
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [offer, offerStatus]);

  // Consumption detection (live only): a newly appeared device means the code was used, mirroring
  // the desktop Flutter client's device-list poll (mobile_access_dialog.dart:405).
  useEffect(() => {
    if (!isLive || offerStatus !== 'active') return;
    const poll = window.setInterval(() => void loadDevices(), 750);
    return () => window.clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, offerStatus]);

  const generateOffer = async () => {
    setGenerating(true);
    deviceCountAtOffer.current = devices.length;
    if (isLive) {
      if (!liveGateway) { setGenerating(false); return; }
      try {
        const created = await liveGateway.createPairingCode();
        setOffer(created);
        setOfferStatus('active');
      } catch (error) {
        setDiagnosticError(errorMessage(error));
      } finally {
        setGenerating(false);
      }
      return;
    }
    setOffer({
      id: `fixture-offer-${Date.now()}`,
      hostId: 'fixture-host',
      pairingCode: Math.random().toString(36).slice(2),
      expiresAt: new Date(Date.now() + FIXTURE_PAIRING_TTL_MS).toISOString(),
    });
    setOfferStatus('active');
    setGenerating(false);
  };

  const dismissOffer = () => { setOffer(null); setOfferStatus('idle'); };

  const simulateFixturePair = () => {
    setDevices((current) => [...current, newFixtureDevice()]);
    setOffer(null);
    setOfferStatus('consumed');
  };

  const enableAccess = async () => {
    setEnabling(true);
    if (isLive) {
      if (!liveGateway) { setEnabling(false); return; }
      try { setDiagnostic(await liveGateway.enable()); }
      catch (error) { setDiagnosticError(errorMessage(error)); }
      finally { setEnabling(false); }
      return;
    }
    setDiagnostic(fixtureDiagnostic('healthy'));
    setEnabling(false);
  };

  const revokeDevice = async (deviceId: string) => {
    setRevokingId(deviceId);
    if (isLive) {
      if (!liveGateway) { setRevokingId(null); return; }
      try { await liveGateway.revokeDevice(deviceId); await loadDevices(); }
      catch (error) { setDevicesError(errorMessage(error)); }
      finally { setRevokingId(null); }
      return;
    }
    setDevices((current) => current.map((device) => device.id === deviceId ? { ...device, revokedAt: new Date().toISOString() } : device));
    setRevokingId(null);
  };

  // The QR payload is exactly {gatewayUrl, pairingCode, relayUrl?} — apps/mobile/lib/pairing/paired-host-store.ts:61.
  // gatewayUrl comes from the access diagnostic, never from the offer response.
  const pairingPayload = offer ? { gatewayUrl: diagnostic?.gatewayUrl ?? null, pairingCode: offer.pairingCode, ...(offer.relayUrl ? { relayUrl: offer.relayUrl } : {}) } : null;

  return (
    <section className="page-shell" data-testid="page-mobile-access" aria-labelledby="mobile-access-title" style={{ padding: 24, display: 'grid', gap: 20, maxWidth: 720 }}>
      <header>
        <span className="eyebrow">Settings</span>
        <h1 id="mobile-access-title">Mobile Access</h1>
        <p>Pair a phone with this Mac over your private Tailscale network.</p>
      </header>

      {diagnosing && !diagnostic && !diagnosticError && (
        <div className="tool-state-panel" role="status" data-testid="mobile-access-loading"><h2>Checking Mobile Access…</h2></div>
      )}

      {diagnosticError && (
        <div className="tool-state-panel error" role="alert" data-testid="mobile-access-error">
          <h2>Mobile access could not be checked</h2>
          <p>{diagnosticError}</p>
          <button className="secondary-button" type="button" onClick={() => void loadDiagnostic()} data-testid="mobile-access-retry">Retry</button>
        </div>
      )}

      {diagnostic && (
        <section aria-labelledby="mobile-access-state-title" data-testid="mobile-access-diagnostic" data-access-state={diagnostic.state}>
          <h2 id="mobile-access-state-title">{STATE_LABEL[diagnostic.state]}</h2>
          <p data-testid="mobile-access-message">{diagnostic.message}</p>
          {diagnostic.gatewayUrl && <p><code data-testid="mobile-access-gateway-url">{diagnostic.gatewayUrl}</code></p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="secondary-button" type="button" onClick={() => void loadDiagnostic()} disabled={diagnosing} data-testid="mobile-access-refresh">{diagnosing ? 'Checking…' : 'Recheck'}</button>
            {diagnostic.canConfigure && (
              <button className="primary-button" type="button" onClick={() => void enableAccess()} disabled={enabling} data-testid="mobile-access-enable">{enabling ? 'Enabling…' : 'Enable Mobile Access'}</button>
            )}
          </div>
        </section>
      )}

      {diagnostic?.state === 'healthy' && (
        <section aria-labelledby="mobile-access-pairing-title" data-testid="mobile-access-pairing">
          <h2 id="mobile-access-pairing-title">Pair a phone</h2>
          {!offer && offerStatus !== 'expired' && offerStatus !== 'consumed' && (
            <button className="primary-button" type="button" onClick={() => void generateOffer()} disabled={generating} data-testid="mobile-access-generate-pairing">{generating ? 'Generating…' : 'Generate pairing code'}</button>
          )}

          {offer && pairingPayload && (
            <div data-testid="mobile-access-pairing-offer">
              <pre data-testid="mobile-access-pairing-payload">{JSON.stringify(pairingPayload)}</pre>
              <p role="status" data-testid="mobile-access-pairing-countdown">Expires in {secondsRemaining}s</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="secondary-button" type="button" onClick={() => void generateOffer()} disabled={generating} data-testid="mobile-access-regenerate-pairing">Regenerate</button>
                {!isLive && (
                  <button className="text-button" type="button" onClick={simulateFixturePair} data-testid="mobile-access-fixture-simulate-pair">Simulate phone pairs (fixture only)</button>
                )}
              </div>
            </div>
          )}

          {offerStatus === 'expired' && (
            <div role="status" data-testid="mobile-access-pairing-expired">
              <p>Pairing code expired.</p>
              <button className="secondary-button" type="button" onClick={dismissOffer} data-testid="mobile-access-pairing-dismiss">Dismiss</button>
            </div>
          )}
          {offerStatus === 'consumed' && (
            <div role="status" data-testid="mobile-access-pairing-consumed">
              <p>A device paired using this code.</p>
              <button className="secondary-button" type="button" onClick={dismissOffer} data-testid="mobile-access-pairing-dismiss">Dismiss</button>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="mobile-access-devices-title" data-testid="mobile-access-devices-section">
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 id="mobile-access-devices-title">Paired devices</h2>
          <button className="secondary-button" type="button" onClick={() => void loadDevices()} data-testid="mobile-access-refresh-devices">Refresh</button>
        </header>
        {devicesError && <p role="alert" data-testid="mobile-access-devices-error">{devicesError}</p>}
        {devicesLoaded && devices.length === 0 && <p data-testid="mobile-access-devices-empty">No paired devices yet.</p>}
        <ul data-testid="mobile-access-devices" style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
          {devices.map((device) => (
            <li key={device.id} data-testid={`mobile-access-device-${device.id}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span><strong>{device.name}</strong> <small data-testid={`mobile-access-device-created-${device.id}`}>{device.createdAt}</small></span>
              {device.revokedAt
                ? <span data-testid={`mobile-access-device-revoked-${device.id}`}>Revoked</span>
                : <button className="text-button" type="button" onClick={() => void revokeDevice(device.id)} disabled={revokingId === device.id} data-testid={`mobile-access-device-revoke-${device.id}`}>{revokingId === device.id ? 'Revoking…' : 'Revoke'}</button>}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
