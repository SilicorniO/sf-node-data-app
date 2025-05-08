// src/salesforce/SalesforceAuthenticator.ts
import * as jsforce from 'jsforce';
import { Connection } from 'jsforce';
import * as dotenv from 'dotenv';

export class SalesforceAuthenticator {
  private static clientId: string;
  private static clientSecret: string;
  private static instanceUrl: string;

  // Static method to set the authentication parameters.
  // This should be called once at the start of the application.
  static setAuthParams(instanceUrl: string) {
    // Load environment variables from .env file
    dotenv.config();

    // Directly fetch from environment variables
    const clientId = process.env.SF_CLIENT_ID;
    const clientSecret = process.env.SF_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        'Client ID and Client Secret must be provided as environment variables (SF_CLIENT_ID, SF_CLIENT_SECRET).'
      );
    }
    SalesforceAuthenticator.clientId = clientId;
    SalesforceAuthenticator.clientSecret = clientSecret;
    SalesforceAuthenticator.instanceUrl = instanceUrl;
  }

  // Static method to authenticate with Salesforce using the Client Credentials flow
  static async authenticate(): Promise<Connection> {
    if (!SalesforceAuthenticator.clientId || !SalesforceAuthenticator.clientSecret || !SalesforceAuthenticator.instanceUrl) {
      throw new Error(
        'Client ID, Client Secret, and Instance URL must be provided.'
      );
    }

    try {
      const conn = new jsforce.Connection({
        clientId: SalesforceAuthenticator.clientId,
        clientSecret: SalesforceAuthenticator.clientSecret,
        instanceUrl: SalesforceAuthenticator.instanceUrl,
      });

      // Use client credentials flow
      const userInfo = await conn.authorize({
        grant_type: 'client_credentials',
      });

      conn.accessToken = userInfo.access_token;
      return conn;
    } catch (error: any) {
      throw new Error(`Salesforce authentication failed: ${error.message}`);
    }
  }
}
