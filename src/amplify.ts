// Decides which data drawer the app uses.
// When Amplify has deployed the backend, it writes amplify_outputs.json next
// to package.json and the build picks it up here. Without that file (local
// preview, the Claude artifact) the app runs on sample data in the browser.
import { Amplify, type ResourcesConfig } from 'aws-amplify';

type Outputs = ResourcesConfig & { custom?: { reportUrl?: string } };

const found = import.meta.glob('../amplify_outputs.json', { eager: true }) as Record<string, { default: Outputs }>;
const outputs = Object.values(found)[0]?.default;

if (outputs) {
  Amplify.configure(outputs);
}

export const BACKEND: 'aws' | 'sample' = outputs ? 'aws' : 'sample';

// The morning-report address for n8n (a plain web address on the push
// function), written into amplify_outputs.json by backend.ts.
export const REPORT_URL: string | null = outputs?.custom?.reportUrl ? `${outputs.custom.reportUrl.replace(/\/$/, '')}/report` : null;
