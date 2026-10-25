import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { Effect, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { EventSourceMapping, FunctionUrlAuthType, HttpMethod, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { staffAdmin } from './functions/staff-admin/resource';
import { push } from './functions/push/resource';
import { board } from './functions/board/resource';

const backend = defineBackend({
  auth,
  data,
  staffAdmin,
  push,
  board,
});

const userPool = backend.auth.resources.userPool;

// ----- Sign in with a username, not an email -----
// defineAuth only offers email or phone sign-in. The user pool is switched
// to plain usernames here (the documented override), and email becomes an
// optional attribute.
const { cfnUserPool, cfnUserPoolClient } = backend.auth.resources.cfnResources;
cfnUserPool.usernameAttributes = [];
cfnUserPool.usernameConfiguration = { caseSensitive: false };
cfnUserPool.schema = [
  { name: 'email', attributeDataType: 'String', mutable: true, required: false },
  { name: 'name', attributeDataType: 'String', mutable: true, required: false },
];

// ----- Short-lived tokens -----
// A switched-off account loses API access within five minutes even if the
// app is still open; the app itself signs the person out within seconds.
// Staff stay signed in on their own phone for 30 days.
cfnUserPoolClient.accessTokenValidity = 5;
cfnUserPoolClient.idTokenValidity = 5;
cfnUserPoolClient.refreshTokenValidity = 30;
cfnUserPoolClient.tokenValidityUnits = { accessToken: 'minutes', idToken: 'minutes', refreshToken: 'days' };
cfnUserPoolClient.enableTokenRevocation = true;

// ----- The staff-admin function may manage logins -----
// Granted here, on the function's own role (data stack), so the auth stack
// never has to point back at the data stack.
const staffAdminLambda = backend.staffAdmin.resources.lambda;
staffAdminLambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminDeleteUser',
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminSetUserPassword',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:AdminRemoveUserFromGroup',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminEnableUser',
      'cognito-idp:AdminUserGlobalSignOut',
      'cognito-idp:AdminListGroupsForUser',
      'cognito-idp:ListUsers',
      'cognito-idp:ListUsersInGroup',
    ],
    resources: [userPool.userPoolArn],
  }),
);
backend.staffAdmin.addEnvironment('USER_POOL_ID', userPool.userPoolId);

// ----- Phone alerts follow the board -----
// Every change to a menu item flows from the table's change stream into the
// push function, which buzzes the phones at that restaurant.
const menuItemTable = backend.data.resources.tables['MenuItem'];
const pushLambda = backend.push.resources.lambda;
const streamPolicy = new Policy(Stack.of(menuItemTable), 'PushMenuItemStreamPolicy', {
  statements: [
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['dynamodb:DescribeStream', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:ListStreams'],
      resources: [menuItemTable.tableStreamArn ?? `${menuItemTable.tableArn}/stream/*`],
    }),
  ],
});
pushLambda.role?.attachInlinePolicy(streamPolicy);
const streamMapping = new EventSourceMapping(Stack.of(menuItemTable), 'PushMenuItemStream', {
  target: pushLambda,
  eventSourceArn: menuItemTable.tableStreamArn,
  startingPosition: StartingPosition.LATEST,
  batchSize: 10,
  retryAttempts: 2,
});
streamMapping.node.addDependency(streamPolicy);

// ----- The report link for n8n -----
// A plain web address on the push function. n8n calls it every morning with
// the key from the Automations screen and gets yesterday's 86s as JSON. The
// function checks the key itself, so the address needs no AWS sign-in.
const reportUrl = pushLambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
  cors: { allowedOrigins: ['*'], allowedMethods: [HttpMethod.GET], allowedHeaders: ['x-86-key', 'content-type'] },
});
backend.addOutput({ custom: { reportUrl: reportUrl.url } });

// ----- The first owner account -----
// Created once, when the backend is first deployed, so there is a way in.
// Username: omar. The temporary password must be changed at first sign-in.
// Lives in the function's stack, which already depends on auth.
const ownerScope = Stack.of(staffAdminLambda);
const OWNER_USERNAME = 'omar';
const OWNER_TEMP_PASSWORD = 'Change-Me-86!';

const createOwner = new AwsCustomResource(ownerScope, 'OwnerUser', {
  onCreate: {
    service: 'CognitoIdentityServiceProvider',
    action: 'adminCreateUser',
    parameters: {
      UserPoolId: userPool.userPoolId,
      Username: OWNER_USERNAME,
      TemporaryPassword: OWNER_TEMP_PASSWORD,
      MessageAction: 'SUPPRESS',
      UserAttributes: [{ Name: 'name', Value: 'Omar' }],
    },
    physicalResourceId: PhysicalResourceId.of(`owner-${OWNER_USERNAME}`),
  },
  policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: [userPool.userPoolArn] }),
  installLatestAwsSdk: false,
});

const ownerInGroup = new AwsCustomResource(ownerScope, 'OwnerGroupMembership', {
  onCreate: {
    service: 'CognitoIdentityServiceProvider',
    action: 'adminAddUserToGroup',
    parameters: {
      UserPoolId: userPool.userPoolId,
      Username: OWNER_USERNAME,
      GroupName: 'owner',
    },
    physicalResourceId: PhysicalResourceId.of(`owner-group-${OWNER_USERNAME}`),
  },
  policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: [userPool.userPoolArn] }),
  installLatestAwsSdk: false,
});
ownerInGroup.node.addDependency(createOwner);
