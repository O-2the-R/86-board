import type { BoardApi } from './types';
import { mockApi } from './mock';

export type { BoardApi } from './types';

// One line to swap the data source. Today: sample data in the browser.
// Next: the AWS adapter, which fills the same drawer from the shared database.
export const api: BoardApi = mockApi;
