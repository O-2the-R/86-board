import { defineBackend } from '@aws-amplify/backend';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { staffAdmin } from './functions/staff-admin/resource';

const backend = defineBackend({
  auth,
  data,
  staffAdmin,
});

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

// ----- The first owner account -----
// Created once, when the backend is first deployed, so there is a way in.
// Username: omar. The temporary password must be changed at first sign-in.
const bootstrap = backend.createStack('bootstrap');
const userPool = backend.auth.resources.userPool;
const OWNER_USERNAME = 'omar';
const OWNER_TEMP_PASSWORD = 'Change-Me-86!';

const createOwner = new AwsCustomResource(bootstrap, 'OwnerUser', {
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

const ownerInGroup = new AwsCustomResource(bootstrap, 'OwnerGroupMembership', {
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
