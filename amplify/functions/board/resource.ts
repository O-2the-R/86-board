import { defineFunction } from '@aws-amplify/backend';

// The only code that changes the board. Behind the changeItem mutation it
// checks who is asking, stamps their name, and keeps the item and its
// history entry in step. Behind repairData it fills in what older rows miss.
export const board = defineFunction({
  name: 'board',
  entry: './handler.ts',
  resourceGroupName: 'data',
  timeoutSeconds: 60,
  memoryMB: 512,
});
