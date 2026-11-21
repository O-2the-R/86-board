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
import { assistant } from './functions/assistant/resource';

const backend = defineBackend({
  auth,
  data,
  staffAdmin,
  push,
  board,
  assistant,
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
// "Set up your own restaurant" removes the sample restaurants and the demo
// logins for good. Staging must keep them (its security test signs in as
// demo staff), so the set-up is switched off there.
backend.staffAdmin.addEnvironment('SITE_SETUP', process.env.SITE_SETUP || (process.env.AWS_BRANCH === 'staging' ? 'off' : 'on'));

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

// ----- Links in the morning email -----
// The "Draft the note" buttons point at the live app. Set APP_URL on the
// Amplify app to use a custom domain; otherwise the address is built from the
// app id and branch that Amplify sets during every build.
const branch = (process.env.AWS_BRANCH ?? '').replace(/[^a-zA-Z0-9-]/g, '-');
const appUrl = process.env.APP_URL || (process.env.AWS_APP_ID && branch ? `https://${branch}.${process.env.AWS_APP_ID}.amplifyapp.com` : '');
backend.push.addEnvironment('APP_URL', appUrl);

// ----- Ask: the AI -----
// The assistant function answers Ask's questions with Claude on Amazon
// Bedrock. Bedrock has no key to keep: the function's own role is allowed to
// call one model, and nothing else in the app can.
//
// The model is named by its "inference profile": us.<model> keeps every
// question inside US data centers (the price list calls this Geo). Set
// ASK_MODEL_ID on the Amplify app to change the model without a code change.
//
// Claude Haiku 4.5 is the default because AWS opens it to every account.
// The newer, cheaper Claude Haiku 5.5 (us.anthropic.claude-haiku-5-5) is
// opened by AWS account by account; an account that does not have it yet
// gets "is not available for this account" (README, "The AI").
const ASK_MODEL_ID = process.env.ASK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const assistantLambda = backend.assistant.resources.lambda;
const assistantStack = Stack.of(assistantLambda);
const viaProfile = /^(us|eu|apac|jp|au|ca|in|us-gov|global)\.(.+)$/.exec(ASK_MODEL_ID);
if (viaProfile) {
  // A profile sends the call on to the model in one of its regions, so the
  // role needs the profile itself, and the model wherever the profile may
  // send it, but only when it is reached through this profile.
  const profileArn = `arn:aws:bedrock:${assistantStack.region}:${assistantStack.account}:inference-profile/${ASK_MODEL_ID}`;
  assistantLambda.addToRolePolicy(new PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: [profileArn] }));
  assistantLambda.addToRolePolicy(
    new PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [`arn:aws:bedrock:*::foundation-model/${viaProfile[2]}`, `arn:aws:bedrock:::foundation-model/${viaProfile[2]}`],
      conditions: { StringEquals: { 'bedrock:InferenceProfileArn': profileArn } },
    }),
  );
} else {
  assistantLambda.addToRolePolicy(
    new PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: [`arn:aws:bedrock:${assistantStack.region}::foundation-model/${ASK_MODEL_ID}`] }),
  );
}
backend.assistant.addEnvironment('ASK_MODEL_ID', ASK_MODEL_ID);
// Questions a day: at one restaurant, and from one login. They cap the bill.
backend.assistant.addEnvironment('ASK_DAILY_LIMIT', process.env.ASK_DAILY_LIMIT || '100');
backend.assistant.addEnvironment('ASK_PERSON_DAILY_LIMIT', process.env.ASK_PERSON_DAILY_LIMIT || '50');
// On staging a sample restaurant with no lists of its own answers from the
// made-up sample lists, so the staging test can ask the AI a real question
// as demo staff. Everywhere else Ask exists only where the owner loaded lists.
backend.assistant.addEnvironment('ASK_SAMPLE_LISTS', process.env.ASK_SAMPLE_LISTS || (process.env.AWS_BRANCH === 'staging' ? 'on' : 'off'));

// ----- The first owner account -----
// On a brand-new deployment there is no way in until an owner exists. Set
// OWNER_TEMP_PASSWORD (and optionally OWNER_USERNAME, default omar) as an
// environment variable on the Amplify app before the first deploy, and this
// creates the owner with that temporary password, to be changed at first
// sign-in. Without the variable nothing is created, which is the normal
// state once the owner exists. The password never lives in the code.
// Lives in the function's stack, which already depends on auth.
const OWNER_TEMP_PASSWORD = process.env.OWNER_TEMP_PASSWORD;
if (OWNER_TEMP_PASSWORD) {
  const ownerScope = Stack.of(staffAdminLambda);
  const OWNER_USERNAME = process.env.OWNER_USERNAME || 'omar';

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
      ignoreErrorCodesMatching: 'UsernameExistsException', // already there: fine
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
}
