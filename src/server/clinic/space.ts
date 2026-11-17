/**
 * The two products on the clinic engine. A clinic and a beauty centre keep their data in the same tables, but a login of
 * one never opens the other (`ClAccount.space`), their cookies live on different paths, and their pages live under
 * `/clinic` and `/beauty`. Which one a request is for is read from the path the visitor asked for.
 */
export type ClSpace = 'CLINIC' | 'BEAUTY';

export const spaceBase = (space: ClSpace): string => (space === 'BEAUTY' ? '/beauty' : '/clinic');

/** The space a path belongs to; anything not under `/beauty` is a clinic's. */
export const spaceOfPath = (path: string | null | undefined): ClSpace => (path === '/beauty' || path?.startsWith('/beauty/') ? 'BEAUTY' : 'CLINIC');

export const spaceHome = (space: ClSpace): string => `${spaceBase(space)}/home`;
export const spaceSignIn = (space: ClSpace): string => `${spaceBase(space)}/sign-in`;
