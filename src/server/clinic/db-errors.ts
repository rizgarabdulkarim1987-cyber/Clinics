/** Whether a database error is a unique-index violation (Prisma P2002 or Postgres 23505), however the driver words it. */
export const isUniqueViolation = (error: unknown): boolean =>
  /P2002|23505|unique constraint|duplicate key/i.test(`${(error as { code?: string })?.code ?? ''} ${(error as Error)?.message ?? ''}`);
