import type { BoardApi } from './types';
import { BACKEND } from '../amplify';
import { inDemo } from '../lib/demo';
import { mockApi } from './mock';
import { awsApi } from './aws';

export type { BoardApi } from './types';

// One place decides where the data comes from: AWS when the backend is
// deployed, sample data in the browser otherwise. The public demo always
// gets sample data, even on the real site, so visitors never reach AWS.
export const api: BoardApi = BACKEND === 'aws' && !inDemo() ? awsApi : mockApi;
