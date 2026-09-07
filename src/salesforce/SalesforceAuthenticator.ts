// src/salesforce/SalesforceAuthenticator.ts
import * as jsforce from 'jsforce';
import { Connection } from 'jsforce';
import axios from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';

const MS_IN_HOUR = 3600000;
const execFileAsync = promisify(execFile);

type AuthMode = 'client_credentials' | 'bearer_token' | 'sf_cli';

export class SalesforceAuthenticator {
  // --- Shared ---
  private static authMode: AuthMode;
  private static instanceUrl: string;
  private static actualConnection: jsforce.Connection;
  private static tokenCreatedAt: number | null = null;

  // --- Client Credentials flow ---
  private static clientId: string;
  private static clientSecret: string;

  // --- Bearer Token flow ---
  private static accessToken: string;

  /**
   * Configure authentication via the OAuth 2.0 Client Credentials flow.
   * Requires a Connected App with "Client Credentials Flow" enabled in Salesforce Setup.
   * The app exchanges clientId + clientSecret for a short-lived access token
   * automatically and refreshes it when it expires.
   */
  static setClientCredentialsParams(
    clientId: string,
    clientSecret: string,
    instanceUrl: string
  ): void {
    SalesforceAuthenticator.authMode      = 'client_credentials';
    SalesforceAuthenticator.clientId      = clientId;
    SalesforceAuthenticator.clientSecret  = clientSecret;
    SalesforceAuthenticator.instanceUrl   = instanceUrl;
    SalesforceAuthenticator.actualConnection = undefined as any;
    SalesforceAuthenticator.tokenCreatedAt   = null;
  }

  /**
   * Configure authentication with a pre-obtained Bearer token.
   * The token can come from any Salesforce OAuth flow (Authorization Code, JWT Bearer,
   * SOAP login session ID, etc.). It is used as-is and never refreshed automatically —
   * the caller is responsible for providing a valid, unexpired token.
   *
   * Set via env vars:
   *   SF_ACCESS_TOKEN=<token>
   *   SF_INSTANCE_URL=https://your-org.my.salesforce.com
   */
  static setBearerTokenParams(
    accessToken: string,
    instanceUrl: string
  ): void {
    SalesforceAuthenticator.authMode      = 'bearer_token';
    SalesforceAuthenticator.accessToken   = accessToken;
    SalesforceAuthenticator.instanceUrl   = instanceUrl;
    SalesforceAuthenticator.actualConnection = undefined as any;
    SalesforceAuthenticator.tokenCreatedAt   = null;
  }

  /** Use the default org currently selected in Salesforce CLI. */
  static setSfCliParams(): void {
    SalesforceAuthenticator.authMode = 'sf_cli';
    SalesforceAuthenticator.instanceUrl = 'sf-cli';
    SalesforceAuthenticator.actualConnection = undefined as any;
    SalesforceAuthenticator.tokenCreatedAt = null;
  }

  /**
   * @deprecated Use setClientCredentialsParams() instead.
   * Kept for backwards compatibility.
   */
  static setAuthParams(
    clientId: string,
    clientSecret: string,
    instanceUrl: string
  ): void {
    SalesforceAuthenticator.setClientCredentialsParams(clientId, clientSecret, instanceUrl);
  }

  /** Returns an authenticated jsforce Connection, creating or refreshing it as needed. */
  static async authenticate(): Promise<Connection> {
    if (!SalesforceAuthenticator.authMode || !SalesforceAuthenticator.instanceUrl) {
      throw new Error(
        'No Salesforce auth params set. Configure environment authentication or Salesforce CLI mode first.'
      );
    }

    if (SalesforceAuthenticator.authMode === 'sf_cli') {
      return SalesforceAuthenticator._authenticateWithSfCli();
    }

    if (SalesforceAuthenticator.authMode === 'bearer_token') {
      return SalesforceAuthenticator._authenticateWithBearerToken();
    }

    return SalesforceAuthenticator._authenticateWithClientCredentials();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private static async _authenticateWithClientCredentials(): Promise<Connection> {
    if (!SalesforceAuthenticator.clientId || !SalesforceAuthenticator.clientSecret) {
      throw new Error('SF_CLIENT_ID and SF_CLIENT_SECRET must be provided for Client Credentials flow.');
    }

    // Re-use the cached connection if the token is less than 1 hour old
    const now = Date.now();
    if (
      SalesforceAuthenticator.actualConnection &&
      SalesforceAuthenticator.tokenCreatedAt &&
      now - SalesforceAuthenticator.tokenCreatedAt < MS_IN_HOUR
    ) {
      return SalesforceAuthenticator.actualConnection;
    }

    try {
      const tokenUrl = `${SalesforceAuthenticator.instanceUrl}/services/oauth2/token`;

      const response: any = await axios.post(tokenUrl, null, {
        params: {
          grant_type:    'client_credentials',
          client_id:     SalesforceAuthenticator.clientId,
          client_secret: SalesforceAuthenticator.clientSecret,
        },
      });

      const accessToken = response.data.access_token;

      SalesforceAuthenticator.actualConnection = new jsforce.Connection({
        instanceUrl:  SalesforceAuthenticator.instanceUrl,
        accessToken,
      });
      SalesforceAuthenticator.tokenCreatedAt = Date.now();

      return SalesforceAuthenticator.actualConnection;
    } catch (error: any) {
      throw new Error(`Salesforce Client Credentials authentication failed: ${error.message}`);
    }
  }

  private static _authenticateWithBearerToken(): Connection {
    if (!SalesforceAuthenticator.accessToken) {
      throw new Error('SF_ACCESS_TOKEN must be provided for Bearer Token authentication.');
    }

    // Build connection once and reuse it for the lifetime of this run
    if (!SalesforceAuthenticator.actualConnection) {
      SalesforceAuthenticator.actualConnection = new jsforce.Connection({
        instanceUrl:  SalesforceAuthenticator.instanceUrl,
        accessToken:  SalesforceAuthenticator.accessToken,
      });
    }

    return SalesforceAuthenticator.actualConnection;
  }

  private static async _authenticateWithSfCli(): Promise<Connection> {
    if (SalesforceAuthenticator.actualConnection) {
      return SalesforceAuthenticator.actualConnection;
    }
    try {
      const { stdout } = await execFileAsync('sf', ['org', 'display', '--json'], {
        maxBuffer: 10 * 1024 * 1024,
      });
      const response = JSON.parse(stdout);
      const result = response?.result;
      if (response?.status !== 0 || !result?.instanceUrl) {
        throw new Error(response?.message || 'The active sf org did not return an instance URL.');
      }
      const targetOrg = result.username || result.alias;
      if (!targetOrg) {
        throw new Error('The active sf org did not return a username or alias.');
      }
      const tokenResponse = await execFileAsync(
        'sf',
        ['org', 'auth', 'show-access-token', '--target-org', targetOrg, '--json'],
        { maxBuffer: 10 * 1024 * 1024 }
      );
      const tokenResult = JSON.parse(tokenResponse.stdout);
      const accessToken = tokenResult?.result?.accessToken;
      if (tokenResult?.status !== 0 || !accessToken) {
        throw new Error(tokenResult?.message || 'Salesforce CLI did not return an access token.');
      }
      SalesforceAuthenticator.instanceUrl = result.instanceUrl;
      SalesforceAuthenticator.accessToken = accessToken;
      SalesforceAuthenticator.actualConnection = new jsforce.Connection({
        instanceUrl: result.instanceUrl,
        accessToken,
      });
      return SalesforceAuthenticator.actualConnection;
    } catch (error: any) {
      const details = error?.stderr?.trim() || error.message;
      throw new Error(
        `Salesforce CLI authentication failed. Set a default org with "sf config set target-org=<alias>". ${details}`
      );
    }
  }
}
