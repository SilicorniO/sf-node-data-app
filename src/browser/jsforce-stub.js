/**
 * Minimal jsforce stub for browser builds.
 *
 * SalesforceAuthenticator only ever uses jsforce.Connection as a thin envelope
 * that holds instanceUrl + accessToken. This stub provides exactly that, so the
 * browser bundle never pulls in the real jsforce package (which requires Node.js).
 */

export class Connection {
  constructor({ instanceUrl = '', accessToken = '' } = {}) {
    this.instanceUrl  = instanceUrl;
    this.accessToken  = accessToken;
  }
}

// Support both "import * as jsforce" and "import { Connection }"
export default { Connection };
