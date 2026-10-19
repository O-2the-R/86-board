import { defineFunction } from '@aws-amplify/backend';

// Phone alerts. Two jobs in one function:
//   1. Behind the pushPublicKey / subscribePush / unsubscribePush operations,
//      it keeps the list of phones that asked for alerts.
//   2. Fed by the MenuItem table's change stream (wired in backend.ts), it
//      sends a push to every phone at that restaurant when an item changes.
export const push = defineFunction({
  name: 'push',
  entry: './handler.ts',
  resourceGroupName: 'data',
  timeoutSeconds: 60,
  memoryMB: 512,
});
