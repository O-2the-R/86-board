import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { staffAdmin } from '../functions/staff-admin/resource';
import { push } from '../functions/push/resource';
import { board } from '../functions/board/resource';

// The shared database. Every phone reads the same tables.
//
// Rules in plain words:
//   - People see their own restaurant only: every item, history entry and
//     staff row carries the groups allowed to read it ("readers"), which are
//     that restaurant's manager, kitchen, server and host groups.
//   - Nobody writes to the board directly. The changeItem mutation runs the
//     board function, which checks the caller's role against the item's
//     restaurant and stamps who did it from their login.
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
        status: a.string().required(), // 'available' | 'low' | 'out'
        outSince: a.datetime(),
        note: a.string(),
        markedBy: a.string(),
        lowCount: a.integer(), // portions left while running low
        lowSince: a.datetime(),
        openEventId: a.string(), // the history entry still open while the item is 86'd
        editors: a.string().array().required(), // groups allowed to change it (checked by the board function)
        readers: a.string().array(), // groups allowed to see it
      })
      .secondaryIndexes((index) => [index('restaurantId')])
      .authorization((allow) => [allow.group('owner'), allow.groupsDefinedIn('readers').to(['read'])]),

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
        readers: a.string().array(),
      })
      .secondaryIndexes((index) => [index('restaurantId').sortKeys(['startedAt'])])
      .authorization((allow) => [allow.group('owner'), allow.groupsDefinedIn('readers').to(['read'])]),

    // One row per login. The id is the username. Readable by the people at
    // that restaurant (they need their own row to know they are still switched
    // on, and managers need the list); the owner's row by the owner only.
    Staff: a
      .model({
        username: a.string().required(),
        displayName: a.string().required(),
        role: a.string().required(), // owner | manager | kitchen | server | host
        restaurantId: a.string().required(), // 'all' for the owner
        active: a.boolean().required(),
        lastChangedBy: a.string(),
        readers: a.string().array(),
      })
      .authorization((allow) => [allow.group('owner').to(['read']), allow.groupsDefinedIn('readers').to(['read'])]),

    // The only way the board changes. action: out | low | back.
    // The board function checks the caller may edit that restaurant, stamps
    // who did it, and keeps the history entry in step with the item.
    changeItem: a
      .mutation()
      .arguments({
        itemId: a.string().required(),
        action: a.string().required(),
        note: a.string(),
        count: a.integer(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(board)),

    // Owner only. Fills in anything older rows are missing (readers, the open
    // history entry on 86'd items). Safe to run any time.
    repairData: a
      .mutation()
      .arguments({ confirm: a.string().required() })
      .returns(a.json())
      .authorization((allow) => [allow.group('owner')])
      .handler(a.handler.function(board)),

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

    // ----- Phone alerts -----
    // One row per phone that asked for alerts. Written only by the push
    // function, which takes the person and restaurant from their login.
    PushSubscription: a
      .model({
        username: a.string().required(),
        restaurantId: a.string().required(), // 'all' for the owner
        endpoint: a.string().required(),
        p256dh: a.string().required(),
        auth: a.string().required(),
        device: a.string(),
      })
      .secondaryIndexes((index) => [index('restaurantId'), index('username')])
      .authorization((allow) => [allow.group('owner').to(['read', 'delete'])]),

    // The signing key pair for alerts, made once by the push function.
    PushKey: a
      .model({
        publicKey: a.string().required(),
        privateKey: a.string().required(),
      })
      .authorization((allow) => [allow.group('owner').to(['read'])]),

    pushPublicKey: a
      .query()
      .returns(a.string())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(push)),

    subscribePush: a
      .mutation()
      .arguments({
        endpoint: a.string().required(),
        p256dh: a.string().required(),
        auth: a.string().required(),
        device: a.string(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(push)),

    unsubscribePush: a
      .mutation()
      .arguments({ endpoint: a.string().required() })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(push)),

    // ----- Automations (n8n) -----
    // One row, id 'n8n': where to send a note on every 86, and the key that
    // proves the note came from us (and that a report request came from n8n).
    Integration: a
      .model({
        webhookUrl: a.string(),
        key: a.string().required(),
        lastTestAt: a.datetime(),
        lastTestResult: a.string(),
      })
      .authorization((allow) => [allow.group('owner')]),

    // Owner only. Sends a sample 86 to the webhook and reports what came back.
    testWebhook: a
      .mutation()
      .arguments({ test: a.string().required() })
      .returns(a.json())
      .authorization((allow) => [allow.group('owner')])
      .handler(a.handler.function(push)),
  })
  .authorization((allow) => [allow.resource(staffAdmin), allow.resource(push), allow.resource(board)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
