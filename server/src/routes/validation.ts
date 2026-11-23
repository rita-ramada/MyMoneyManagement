import { z } from 'zod';

/** `YYYY-MM-DD` that is a real calendar date (rejects 2026-13-45, 2026-02-31). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'must be a valid calendar date');

/** `YYYY-MM` with month 01-12. */
export const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be YYYY-MM');
