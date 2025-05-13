// src/salesforce/SalesforceAuthenticator.ts
import * as jsforce from 'jsforce';
import { Connection } from 'jsforce';
import axios from 'axios'; // Import axios for HTTP requests

const MS_IN_HOUR = 3600000; // 1 hour in milliseconds

export class SalesforceAuthenticator {
  private static clientId: string;
  private static clientSecret: string;
  private static instanceUrl: string;

  private static actualConnection: jsforce.Connection;
  private static tokenCreatedAt: number | null = null; // Store the timestamp when the token was generated

  // Static method to set the authentication parameters.
  // This should be called once at the start of the application.
  static setAuthParams(
    clientId: string,
    clientSecret: string,
    instanceUrl: string
  ) {
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

    // If there is an existing connection and the token is less than 1 hour old, return it
    const now = Date.now();
    if (
      SalesforceAuthenticator.actualConnection &&
      SalesforceAuthenticator.tokenCreatedAt &&
      (now - SalesforceAuthenticator.tokenCreatedAt < MS_IN_HOUR)
    ) {
      return SalesforceAuthenticator.actualConnection;
    }

    try {
      const tokenUrl = `${SalesforceAuthenticator.instanceUrl}/services/oauth2/token`;

      // Make a POST request to get the access token
      const response: any = await axios.post(tokenUrl, null, {
        params: {
          grant_type: 'client_credentials',
          client_id: SalesforceAuthenticator.clientId,
          client_secret: SalesforceAuthenticator.clientSecret,
        },
      });

      const accessToken = response.data.access_token;

      // Create a jsforce connection with the access token
      SalesforceAuthenticator.actualConnection = new jsforce.Connection({
        instanceUrl: SalesforceAuthenticator.instanceUrl,
        accessToken: accessToken,
      });

      SalesforceAuthenticator.tokenCreatedAt = Date.now(); // Save the time when the token was generated

      return SalesforceAuthenticator.actualConnection;
    } catch (error: any) {
      throw new Error(`Salesforce authentication failed: ${error.message}`);
    }
  }
}
