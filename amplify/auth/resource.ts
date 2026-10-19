import { defineAuth } from '@aws-amplify/backend';
import { staffAdmin } from '../functions/staff-admin/resource';

// Who can do what is decided by Cognito groups:
//   owner                 Omar. Every restaurant, every screen.
//   <restaurant>-manager  edits that restaurant's board, manages its staff
//   <restaurant>-kitchen  edits that restaurant's board
//   <restaurant>-server   view only
//   <restaurant>-host     view only
const RESTAURANT_IDS = ['main', 'water', 'counter'];
const ROLES = ['manager', 'kitchen', 'server', 'host'];

export const GROUPS = ['owner', ...RESTAURANT_IDS.flatMap((r) => ROLES.map((role) => `${r}-${role}`))];

export const auth = defineAuth({
  // Staff sign in with a plain username (marco.r). backend.ts switches the
  // user pool from email sign-in to username sign-in.
  loginWith: {
    email: true,
  },
  groups: GROUPS,
  access: (allow) => [
    allow.resource(staffAdmin).to(['manageUsers', 'manageGroupMembership', 'managePasswordRecovery', 'listUsers', 'listUsersInGroup']),
  ],
});
