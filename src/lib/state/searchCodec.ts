import { stringifySearchWith } from '@tanstack/react-router';

const encodeSearch = stringifySearchWith(JSON.stringify, JSON.parse);

/** Sub-delims a query value may carry literally; `&`, `=`, `+`, `#`, `%` and spaces stay escaped. */
const READABLE = /%(2C|3A|2F|40|21|24|3B|2A|28|29|27)/gi;

/** TanStack's serializer, minus the escapes that make `lat,lng`, times and zones unreadable. */
export const stringifySearch = (search: Record<string, unknown>): string =>
  encodeSearch(search).replace(READABLE, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
