import type { BoardApi } from './types';
import { BACKEND } from '../amplify';
import { mockApi } from './mock';
import { awsApi } from './aws';

export type { BoardApi } from './types';

// One place decides where the data comes from: AWS when the backend is
// deployed, sample data in the browser otherwise.
export const api: BoardApi = BACKEND === 'aws' ? awsApi : mockApi;
