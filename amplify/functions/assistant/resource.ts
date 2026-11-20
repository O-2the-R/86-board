import { defineFunction } from '@aws-amplify/backend';

// Ask, the chat. The only code that reads a restaurant's stored lists and the
// only code that talks to the AI (Claude, on Amazon Bedrock). Behind
// getAssistant it hands the lists to the people allowed to use Ask; behind
// askAssistant it answers one question; behind manageAssistant the owner
// loads, shares or removes a restaurant's lists. Its permission to call the
// AI is granted in backend.ts.
export const assistant = defineFunction({
  name: 'assistant',
  entry: './handler.ts',
  resourceGroupName: 'data',
  timeoutSeconds: 30,
  memoryMB: 1024,
});
