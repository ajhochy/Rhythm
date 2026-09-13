import { fireEvent, render } from '@testing-library/react-native';
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
  expect(screen.getByText('Restoring your session…')).toBeTruthy();

  screen.rerender(<SignInScreen {...props} state="signedOut" />);
  fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' }));
  expect(props.onSignIn).toHaveBeenCalledTimes(1);

  screen.rerender(<SignInScreen {...props} state="signingIn" />);
  expect(screen.getByRole('button', { name: 'Continue with Google' }).props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  fireEvent.press(screen.getByRole('button', { name: 'Cancel sign in' }));
  expect(props.onCancel).toHaveBeenCalledTimes(1);

  screen.rerender(<SignInScreen {...props} errorMessage="Sign in was cancelled" state="error" />);
  expect(screen.getByTestId('sign-in-error').props.accessibilityRole).toBe('alert');
  expect(screen.getByText('Sign in was cancelled')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Retry sign in with Google' }));
  expect(props.onRetry).toHaveBeenCalledTimes(1);
});
