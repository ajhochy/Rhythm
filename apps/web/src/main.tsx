import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { FixtureProvider } from './store';
import { composeGateway } from './gateway';
import { GatewayProvider } from './gateway/context';
import { AuthUserProvider, GoogleSignIn, type AuthLoginResponse, type AuthUser, type DesktopAuthBridge } from './gateway/auth';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
const environment = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;
const runtimeGateway = (window as Window & {
  rhythmShell?: {
    gateway?: {
      apiBase?: string;
      engineBase?: string;
    };
    auth?: DesktopAuthBridge;
  };
}).rhythmShell;
const gatewayMode = environment.VITE_RHYTHM_GATEWAY_MODE;
const apiBase = runtimeGateway?.gateway?.apiBase ?? environment.VITE_RHYTHM_API_BASE;
const engineBase = runtimeGateway?.gateway?.engineBase ?? environment.VITE_RHYTHM_ENGINE_BASE;

const renderGateway = (taskToken?: string, user?: AuthUser) => {
  const gateway = composeGateway({
    mode: gatewayMode,
    apiBase,
    engineBase,
    taskToken,
  });
  const app = <FixtureProvider><App /></FixtureProvider>;
  root.render(
    <React.StrictMode>
      <GatewayProvider gateway={gateway}>
        {user ? <AuthUserProvider user={user}>{app}</AuthUserProvider> : app}
      </GatewayProvider>
    </React.StrictMode>,
  );
};

const renderStartupError = (error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  root.render(
    <main role="alert" style={{ maxWidth: 640, margin: '15vh auto', padding: 24 }}>
      <h1>Live gateway could not start</h1>
      <p>{detail}</p>
      <p>This live build is not configured. Set the Electron host runtime environment or explicit Vite development values, then restart.</p>
    </main>,
  );
};

try {
  // TEST-ONLY override: existing Vite/Playwright live harnesses inject this disposable bearer.
  // The packaged build neutralizes this value, and the Electron host never exposes a token.
  const testOnlyToken = environment.VITE_RHYTHM_LIVE_TOKEN;
  if (gatewayMode === 'live' && !testOnlyToken) {
    if (!apiBase || !engineBase) {
      // A missing ADDRESS and a missing TOKEN are different failures and must not share one state.
      // Signing in cannot supply an API address, so this is a fatal configuration error rather than
      // a signed-out state. slice-2-c5-ui requires exactly that: requested-live with invalid
      // configuration renders a fatal error and never silently mounts the fixture workspace.
      // Routing it through renderNotConfigured() conflated the two and regressed the M1 gate.
      renderStartupError(new Error(
        'Live configuration error: API and engine addresses must come from the Electron host runtime or explicit Vite development values.',
      ));
    } else {
      const onAuthenticated = (login: AuthLoginResponse) => {
        try { renderGateway(login.sessionToken, login.user); } catch (error) { renderStartupError(error); }
      };
      root.render(
        <React.StrictMode>
          <GoogleSignIn auth={runtimeGateway?.auth} onAuthenticated={onAuthenticated} />
        </React.StrictMode>,
      );
    }
  } else {
    renderGateway(testOnlyToken);
  }
} catch (error) {
  renderStartupError(error);
}
