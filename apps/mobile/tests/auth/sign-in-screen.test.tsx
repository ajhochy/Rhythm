import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fireEvent, render } from '@testing-library/react-native';
import { Image, ScrollView, StyleSheet } from 'react-native';
import { SignInScreen } from '@/components/auth/sign-in-screen';

type SignInProps = {
  errorMessage?: string;
  onCancel: () => void;
  onRetry: () => void;
  onSignIn: () => void;
  state: 'restoring' | 'signedOut' | 'signingIn' | 'error';
};

test('task-ios-mobile-ui-c5: sign-in presentation exposes restoring, action, cancel, error, and retry states', () => {
  // Regression caught: first-run users have no dedicated sign-in surface or recoverable OAuth states.
  const props: SignInProps = {
    onCancel: jest.fn(),
    onRetry: jest.fn(),
    onSignIn: jest.fn(),
    state: 'restoring',
  };
  const screen = render(<SignInScreen {...props} />);
  const scroll = screen.UNSAFE_getByType(ScrollView);
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toEqual(
    expect.objectContaining({ flexGrow: 1 }),
  );
  expect(screen.getByRole('header', { name: 'Welcome to Rhythm Agents' })).toBeTruthy();
  expect(screen.getByText('Continue with your Rhythm account to connect to your Mac and chats.')).toBeTruthy();
  expect(screen.getByText('Restoring your session…')).toBeTruthy();
  expect(screen.queryByText('Your account controls trusted device access.')).toBeNull();
  expect(screen.UNSAFE_queryByType(Image)).toBeNull();
  expect(screen.UNSAFE_getAllByType(MaterialCommunityIcons).some(
    (node) => node.props.name === 'source-branch',
  )).toBe(true);
  expect(screen.getByLabelText('Rhythm').props.accessible).toBe(false);

  screen.rerender(<SignInScreen {...props} state="signedOut" />);
  const continueButton = screen.getByRole('button', { name: 'Continue with Google' });
  const signedOutTrust = screen.getByText('Your account controls trusted device access.');
  const signedOutNodes = screen.UNSAFE_root.findAll(() => true);
  expect(signedOutNodes.indexOf(signedOutTrust)).toBeGreaterThan(signedOutNodes.indexOf(continueButton));
  fireEvent.press(continueButton);
  expect(props.onSignIn).toHaveBeenCalledTimes(1);

  screen.rerender(<SignInScreen {...props} state="signingIn" />);
  const signingInButton = screen.getByRole('button', { name: 'Continue with Google' });
  const trust = screen.getByText('Your account controls trusted device access.');
  const cancel = screen.getByRole('button', { name: 'Cancel sign in' });
  const signingInNodes = screen.UNSAFE_root.findAll(() => true);
  expect(signingInButton.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  expect(signingInNodes.indexOf(trust)).toBeGreaterThan(signingInNodes.indexOf(signingInButton));
  expect(signingInNodes.indexOf(cancel)).toBeGreaterThan(signingInNodes.indexOf(trust));
  fireEvent.press(cancel);
  expect(props.onCancel).toHaveBeenCalledTimes(1);

  screen.rerender(<SignInScreen {...props} errorMessage="Sign in was cancelled" state="error" />);
  const error = screen.getByTestId('sign-in-error');
  const retry = screen.getByRole('button', { name: 'Retry sign in with Google' });
  const errorTrust = screen.getByText('Your account controls trusted device access.');
  const errorNodes = screen.UNSAFE_root.findAll(() => true);
  expect(error.props.accessibilityRole).toBe('alert');
  expect(screen.getByText('Sign in was cancelled')).toBeTruthy();
  expect(errorNodes.indexOf(retry)).toBeGreaterThan(errorNodes.indexOf(error));
  expect(errorNodes.indexOf(errorTrust)).toBeGreaterThan(errorNodes.indexOf(retry));
  fireEvent.press(retry);
  expect(props.onRetry).toHaveBeenCalledTimes(1);
});
