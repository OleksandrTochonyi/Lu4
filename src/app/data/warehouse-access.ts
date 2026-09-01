/**
 * E-mails allowed to open the Warehouse ("WH") page in addition to admins.
 * Add lower-case addresses here — matching is case-insensitive.
 */
export const WAREHOUSE_EMAILS: readonly string[] = [
  'analcrush@gmail.com',
  'dianta2025@gmail.com',
];

/** case-insensitive membership check */
export function isWarehouseEmail(email: string | null | undefined): boolean {
  const e = String(email ?? '').trim().toLowerCase();
  return !!e && WAREHOUSE_EMAILS.some((a) => a.trim().toLowerCase() === e);
}
