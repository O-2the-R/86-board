import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { staffAdmin } from '../functions/staff-admin/resource';

// The shared database. Every phone reads the same tables.
//
// Rules in plain words:
//   - Anyone signed in can read the boards and the history.
//   - A restaurant's managers and kitchen (the "editors" groups stored on
//     each record) can change that restaurant's items and 86 events.
//   - The owner can do anything.
//   - Staff accounts are changed only through the manageStaff mutation,
//     which runs the staff-admin function.
const schema = a
  .schema({
    Restaurant: a
      .model({
        name: a.string().required(),
        kind: a.string().required(),
        sortOrder: a.integer(),
      })
      .authorization((allow) => [allow.authenticated().to(['read']), allow.group('owner')]),

    MenuItem: a
      .model({
        restaurantId: a.string().required(),
        name: a.string().required(),
        category: a.string().required(),
        vendor: a.string(),
        sortOrder: a.integer(),
        status: a.string().required(), // 'available' | 'out'
        outSince: a.datetime(),
        note: a.string(),
        markedBy: a.string(),
        editors: a.string().array().required(), // groups allowed to update
      })
      .secondaryIndexes((index) => [index('restaurantId')])
      .authorization((allow) => [
        allow.authenticated().to(['read']),
        allow.group('owner'),
        allow.groupsDefinedIn('editors').to(['update']),
      ]),

    EightySixEvent: a
      .model({
        restaurantId: a.string().required(),
        itemId: a.string().required(),
        itemName: a.string().required(),
        startedAt: a.datetime().required(),
        endedAt: a.datetime(),
        note: a.string(),
        markedBy: a.string().required(),
        clearedBy: a.string(),
        editors: a.string().array().required(),
      })
      .secondaryIndexes((index) => [index('restaurantId').sortKeys(['startedAt'])])
      .authorization((allow) => [
        allow.authenticated().to(['read']),
        allow.group('owner'),
        allow.groupsDefinedIn('editors').to(['create', 'update']),
      ]),

    // One row per login. The id is the username.
    Staff: a
      .model({
        username: a.string().required(),
        displayName: a.string().required(),
        role: a.string().required(), // owner | manager | kitchen | server | host
        restaurantId: a.string().required(), // 'all' for the owner
        active: a.boolean().required(),
        lastChangedBy: a.string(),
      })
      .authorization((allow) => [allow.authenticated().to(['read'])]),

    // action: create | deactivate | reactivate | resetPassword
    // password: optional on create. Given, it is the person's real password;
    // left out, they get a temporary one and choose their own at first sign-in.
    manageStaff: a
      .mutation()
      .arguments({
        action: a.string().required(),
        username: a.string().required(),
        displayName: a.string(),
        role: a.string(),
        restaurantId: a.string(),
        password: a.string(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.groups(['owner', 'main-manager', 'water-manager', 'counter-manager'])])
      .handler(a.handler.function(staffAdmin)),

    // Owner only. Loads the three sample restaurants, menus, history and 60 staff.
    seedDemo: a
      .mutation()
      .arguments({ confirm: a.string().required() })
      .returns(a.json())
      .authorization((allow) => [allow.group('owner')])
      .handler(a.handler.function(staffAdmin)),
  })
  .authorization((allow) => [allow.resource(staffAdmin)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
