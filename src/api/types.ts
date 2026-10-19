import type { EightySixEvent, MenuItem, Restaurant } from '../types';

// The "data drawer". The screens only talk to this.
// Today it is filled by sample data saved in the browser (mock.ts).
// Next it will be filled by the real AWS database, with no change to the screens.
export interface BoardApi {
  listRestaurants(): Promise<Restaurant[]>;
  listItems(restaurantId: string): Promise<MenuItem[]>;
  markOut(itemId: string, note: string, by: string): Promise<void>;
  markBack(itemId: string, by: string): Promise<void>;
  listHistory(restaurantId: string, days: number): Promise<EightySixEvent[]>;
}
