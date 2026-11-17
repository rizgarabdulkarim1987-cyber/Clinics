import { headers } from 'next/headers';
import { REQUEST_PATH_HEADER } from '@/server/http/request-path';
import { spaceOfPath, type ClSpace } from './space';

/** The space of the current request: `/beauty/...` is a beauty centre's, everything else a clinic's. */
export async function requestSpace(): Promise<ClSpace> {
  return spaceOfPath((await headers()).get(REQUEST_PATH_HEADER));
}
