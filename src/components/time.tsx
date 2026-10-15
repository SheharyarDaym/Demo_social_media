import { DateTime } from 'luxon';
import { useStore } from '../store/store';

export function useNow(): Date {
  // Subscribe to the tick so time-derived UI refreshes and clock advances re-render.
  useStore((s) => s.tick);
  const offset = useStore((s) => s.data.preview.clockOffsetMs);
  return new Date(Date.now() + offset);
}

export function fmt(iso: string | null | undefined, zone: string, pattern = "ccc d LLL, HH:mm"): string {
  if (!iso) return '—';
  const dt = DateTime.fromISO(iso).setZone(zone);
  return dt.isValid ? dt.toFormat(pattern) : '—';
}

/** Value for <input type="datetime-local"> representing an instant in a zone. */
export function toLocalInput(iso: string | null | undefined, zone: string): string {
  if (!iso) return '';
  const dt = DateTime.fromISO(iso).setZone(zone);
  return dt.isValid ? dt.toFormat("yyyy-LL-dd'T'HH:mm") : '';
}

/** Parse a datetime-local value as wall-clock time in `zone`, returning a UTC ISO instant. */
export function fromLocalInput(value: string, zone: string): string | null {
  if (!value) return null;
  const dt = DateTime.fromISO(value, { zone });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

export function zoneLabel(zone: string, at = new Date()): string {
  const dt = DateTime.fromJSDate(at).setZone(zone);
  return `${zone.replaceAll('_', ' ')} (${dt.toFormat('ZZZZ')}, UTC${dt.toFormat('ZZ')})`;
}

export function DateTimeInput({
  value,
  zone,
  onChange,
  id,
  label,
  invalid,
}: {
  value: string | null;
  zone: string;
  onChange: (iso: string | null) => void;
  id?: string;
  label: string;
  invalid?: boolean;
}) {
  return (
    <input
      id={id}
      type="datetime-local"
      className="input"
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={toLocalInput(value, zone)}
      onChange={(e) => onChange(fromLocalInput(e.target.value, zone))}
    />
  );
}
