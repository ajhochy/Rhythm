import { createTrailingCoalescer } from '@/lib/coalesce';

describe('trailing event coalescing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('collapses a burst into one trailing call', () => {
    const callback = jest.fn();
    const coalescer = createTrailingCoalescer(750, callback);

    coalescer.trigger();
    jest.advanceTimersByTime(500);
    coalescer.trigger();
    jest.advanceTimersByTime(749);
    expect(callback).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test('cancel prevents a pending call', () => {
    const callback = jest.fn();
    const coalescer = createTrailingCoalescer(1000, callback);

    coalescer.trigger();
    coalescer.cancel();
    jest.runAllTimers();

    expect(callback).not.toHaveBeenCalled();
  });
});
