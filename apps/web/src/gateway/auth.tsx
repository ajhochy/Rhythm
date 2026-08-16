import { createContext, useContext, useState } from 'react';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
  isFacilitiesManager?: boolean;
  photoUrl?: string | null;
  emailNotificationsEnabled?: boolean;
  artifactTabIds?: string[];
}

export interface AuthLoginResponse {
  sessionToken: string;
  user: AuthUser;
}

export interface DesktopAuthBridge {
  signInWithGoogle(): Promise<AuthLoginResponse>;
}

// The signed-in identity (and its server-persisted artifactTabIds) is only known where sign-in
// happens (main.tsx). Everything below the App root that needs "who is this" or needs to persist
// artifactTabIds reads it from this context rather than re-deriving it or caching it locally —
// per-user tab restore must be identity-bound, not component-memory-bound.
interface AuthUserState {
  user: AuthUser;
  setArtifactTabIds(ids: string[]): void;
}

const AuthUserContext = createContext<AuthUserState | null>(null);

export function AuthUserProvider({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  const [current, setCurrent] = useState(user);
  return (
    <AuthUserContext.Provider value={{ user: current, setArtifactTabIds: (artifactTabIds) => setCurrent((existing) => ({ ...existing, artifactTabIds })) }}>
      {children}
    </AuthUserContext.Provider>
  );
}

// Returns null outside a live sign-in session (fixture mode, or a live harness that authenticates
// via the test-only token and skips GoogleSignIn) — callers must treat that as "no identity-bound
// artifact tabs available" rather than throwing.
export function useAuthUser(): AuthUserState | null {
  return useContext(AuthUserContext);
}

export function GoogleSignIn({ auth, onAuthenticated }: {
  auth?: DesktopAuthBridge;
  onAuthenticated(login: AuthLoginResponse): void;
}) {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    if (!auth || signingIn) return;
    setSigningIn(true);
    setError(null);
    try {
      const login = await auth.signInWithGoogle();
      if (!login?.sessionToken || !login.user) throw new Error('Google sign-in returned an invalid session');
      onAuthenticated(login);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : String(signInError));
      setSigningIn(false);
    }
  };

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)', color: 'var(--fg)' }}>
      <section aria-labelledby="sign-in-title" style={{ width: 'min(420px, 100%)', padding: 32, border: '1px solid var(--border)', borderRadius: 18, background: 'var(--surface-raised)', boxShadow: '0 24px 70px rgb(0 0 0 / 18%)' }}>
        <p style={{ margin: '0 0 8px', color: 'var(--muted)', font: '600 11px var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Rhythm desktop</p>
        <h1 id="sign-in-title" style={{ margin: '0 0 10px' }}>Sign in to Rhythm</h1>
        <p style={{ margin: '0 0 24px', color: 'var(--muted)' }}>Use your Google account to open your live workspace and calendar access.</p>
        <button className="primary-button" type="button" onClick={() => void signIn()} disabled={!auth || signingIn} style={{ width: '100%' }}>
          {signingIn ? 'Waiting for Google…' : 'Continue with Google'}
        </button>
        {!auth && <p role="status" style={{ margin: '16px 0 0', color: 'var(--muted)' }}>Google sign-in is available in the Rhythm desktop app.</p>}
        {error && <p role="alert" style={{ margin: '16px 0 0', color: 'var(--danger)' }}>{error}</p>}
      </section>
    </main>
  );
}
