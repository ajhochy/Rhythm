import { Redirect } from 'expo-router';

import { SignInScreen } from '@/components/auth/sign-in-screen';
import { usePairedHost } from '@/providers/paired-host-provider';
import { useRhythmAccount } from '@/providers/rhythm-account-provider';

export default function IndexScreen() {
  const account = useRhythmAccount();
  const pairedHost = usePairedHost();

  if (
    account.isRestoring ||
    account.state === 'refreshing' ||
    (account.state === 'signedIn' && pairedHost.bootstrapState === 'discovering')
  ) {
    return (
      <SignInScreen
        onCancel={account.cancelSignIn}
        onRetry={() => void account.refresh().catch(() => undefined)}
        onSignIn={() => void account.signIn().catch(() => undefined)}
        state="restoring"
      />
    );
  }

  if (account.state !== 'signedIn' || !account.user) {
    const errorState = ['error', 'offline', 'expired'].includes(account.state);
    return (
      <SignInScreen
        errorMessage={account.error?.message}
        onCancel={account.cancelSignIn}
        onRetry={() => void account.signIn().catch(() => undefined)}
        onSignIn={() => void account.signIn().catch(() => undefined)}
        state={account.state === 'signingIn' ? 'signingIn' : errorState ? 'error' : 'signedOut'}
      />
    );
  }

  return <Redirect href="/(tabs)/agents" />;
}
