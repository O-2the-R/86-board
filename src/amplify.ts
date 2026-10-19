// Decides which data drawer the app uses.
// When Amplify has deployed the backend, it writes amplify_outputs.json next
// to package.json and the build picks it up here. Without that file (local
// preview, the Claude artifact) the app runs on sample data in the browser.
import { Amplify, type ResourcesConfig } from 'aws-amplify';

const found = import.meta.glob('../amplify_outputs.json', { eager: true }) as Record<string, { default: ResourcesConfig }>;
const outputs = Object.values(found)[0]?.default;

if (outputs) {
  Amplify.configure(outputs);
}

export const BACKEND: 'aws' | 'sample' = outputs ? 'aws' : 'sample';
