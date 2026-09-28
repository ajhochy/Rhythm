/* eslint-disable @typescript-eslint/no-require-imports */
const mockScheduleNotificationAsync = jest.fn(async (_request: {
  content: { body?: string };
  trigger: null;
}) => 'notification-id');
const mockGetPermissionsAsync = jest.fn(async () => ({ granted: true }));
const mockRequestPermissionsAsync = jest.fn(async () => ({ granted: true }));

jest.mock('@opencode-ai/sdk/v2/client', () => ({
  createOpencodeClient: jest.fn(),
}), { virtual: true });

jest.mock('expo-notifications', () => ({
  __esModule: true,
  default: {
    getPermissionsAsync: mockGetPermissionsAsync,
    requestPermissionsAsync: mockRequestPermissionsAsync,
    scheduleNotificationAsync: mockScheduleNotificationAsync,
  },
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: mockGetPermissionsAsync,
  requestPermissionsAsync: mockRequestPermissionsAsync,
  scheduleNotificationAsync: mockScheduleNotificationAsync,
  setNotificationChannelAsync: jest.fn(async () => undefined),
  setNotificationHandler: jest.fn(),
}));
jest.mock('expo-notifications/build/index.js', () => ({
  __esModule: true,
  default: {
    getPermissionsAsync: mockGetPermissionsAsync,
    requestPermissionsAsync: mockRequestPermissionsAsync,
    scheduleNotificationAsync: mockScheduleNotificationAsync,
  },
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: mockGetPermissionsAsync,
  requestPermissionsAsync: mockRequestPermissionsAsync,
  scheduleNotificationAsync: mockScheduleNotificationAsync,
  setNotificationChannelAsync: jest.fn(async () => undefined),
  setNotificationHandler: jest.fn(),
}));
jest.mock('expo-background-task', () => ({
  __esModule: true,
  BackgroundTaskResult: { Failed: 0, Success: 1 },
  BackgroundTaskStatus: { Available: 1 },
  getStatusAsync: jest.fn(async () => 1),
  registerTaskAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-task-manager', () => ({
  __esModule: true,
  defineTask: jest.fn(),
  isTaskDefined: jest.fn(() => true),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null) },
}));

const { Platform } = require('react-native') as typeof import('react-native');
const notificationModule = require('expo-notifications') as typeof import('expo-notifications');
Object.assign(notificationModule, {
  getPermissionsAsync: mockGetPermissionsAsync,
  requestPermissionsAsync: mockRequestPermissionsAsync,
  scheduleNotificationAsync: mockScheduleNotificationAsync,
});
const { notifyQuestionRequired } = require('@/lib/notifications') as typeof import('@/lib/notifications');

describe('question-required notifications', () => {
  beforeEach(() => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: true });
  });

  afterEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  });

  test('task-mobile-question-state-c5: native content uses session title and first question without requesting permission', async () => {
    // Regression caught: question arrival prompts for permission or emits generic content that cannot identify the chat.
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });

    await notifyQuestionRequired('Weekend plan', {
      custom: false,
      header: 'Approach',
      multiple: false,
      options: [],
      question: 'Which implementation should be used?',
    });

    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith({
      content: expect.objectContaining({
        body: expect.stringContaining('Weekend plan'),
        title: 'Answer needed',
      }),
      trigger: null,
    });
    const body = mockScheduleNotificationAsync.mock.calls[0]?.[0].content.body;
    expect(body).toContain('Weekend plan');
    expect(body).toContain('Approach');
    expect(body).toContain('Which implementation should be used?');
  });

  test('task-mobile-question-state-c5-denied: denied native permission schedules nothing and never prompts', async () => {
    // Regression caught: an incoming question requests permission or schedules despite an explicit native denial.
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    mockGetPermissionsAsync.mockResolvedValueOnce({ granted: false });

    await notifyQuestionRequired('Weekend plan', {
      custom: false,
      header: 'Approach',
      multiple: false,
      options: [],
      question: 'Which implementation should be used?',
    });

    expect(mockGetPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  test('task-mobile-question-state-c5-web: web notification is a no-op', async () => {
    // Regression caught: web attempts to call the unavailable native notification scheduler.
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });

    await notifyQuestionRequired('Weekend plan', {
      custom: false,
      header: 'Approach',
      multiple: false,
      options: [],
      question: 'Which implementation should be used?',
    });

    expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
