import { formatTimestamp, type TimestampOptions } from '../timestamps';

export function Timestamp({ value, fallback = 'Time unavailable', ...options }: { value: unknown; fallback?: string } & TimestampOptions) {
  const formatted = formatTimestamp(value, options);
  if (!formatted) return <span data-timestamp-fallback="true">{fallback}</span>;
  return <time dateTime={formatted.iso} title={formatted.full}><span aria-hidden="true">{formatted.label}</span><span className="sr-only">{formatted.full}</span></time>;
}
