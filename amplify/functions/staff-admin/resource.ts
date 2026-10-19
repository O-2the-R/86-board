import { defineFunction } from '@aws-amplify/backend';

// The only piece of code allowed to create, switch off, or reset staff
// accounts. The app calls it through the manageStaff and seedDemo mutations.
export const staffAdmin = defineFunction({
  name: 'staff-admin',
  entry: './handler.ts',
  resourceGroupName: 'data',
  timeoutSeconds: 60,
  memoryMB: 512,
});
