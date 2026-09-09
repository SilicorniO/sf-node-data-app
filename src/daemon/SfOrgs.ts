// src/daemon/SfOrgs.ts
//
// Thin helpers around the Salesforce CLI (`sf`) used by the UI daemon to discover
// authorized orgs and resolve a fresh access token for a picked org. All auth still
// funnels into the pipeline CLI's existing bearer-token env path
// (SF_ACCESS_TOKEN / SF_INSTANCE_URL); the daemon never mutates the user's global
// `sf config`.
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024;

export interface SfOrg {
  alias: string;
  username: string;
  instanceUrl: string;
  isDefault: boolean;
}

export interface SfAvailability {
  sfAvailable: boolean;
  orgs: SfOrg[];
}

export interface ResolvedSfToken {
  accessToken: string;
  instanceUrl: string;
}

/** Raised when `sf` cannot produce a usable token for a picked org (expired / not logged in). */
export class SfTokenError extends Error {}

/**
 * Lists authorized orgs via `sf org list --json`. Returns `sfAvailable: false` when
 * the CLI is missing or errors, so the UI can fall back to a pasted token.
 */
export async function listOrgs(): Promise<SfAvailability> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('sf', ['org', 'list', '--json'], { maxBuffer: MAX_BUFFER }));
  } catch {
    return { sfAvailable: false, orgs: [] };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { sfAvailable: true, orgs: [] };
  }

  const result = parsed?.result ?? {};
  // `sf org list` groups orgs (nonScratchOrgs, scratchOrgs, devHubs, sandboxes...).
  // Flatten every array under result and de-duplicate by username.
  const groups: any[] = Object.values(result).filter(Array.isArray) as any[];
  const byUsername = new Map<string, SfOrg>();
  for (const group of groups) {
    for (const entry of group) {
      const username = entry?.username;
      const instanceUrl = entry?.instanceUrl;
      if (!username || !instanceUrl) continue;
      if (byUsername.has(username)) {
        // Preserve default flag if any grouping marks it as such.
        if (entry?.isDefaultUsername) byUsername.get(username)!.isDefault = true;
        continue;
      }
      byUsername.set(username, {
        alias: entry?.alias || '',
        username,
        instanceUrl,
        isDefault: Boolean(entry?.isDefaultUsername),
      });
    }
  }

  const orgs = Array.from(byUsername.values()).sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return (a.alias || a.username).localeCompare(b.alias || b.username);
  });
  return { sfAvailable: true, orgs };
}

/**
 * Resolves a fresh access token + instance URL for a specific org (alias or username).
 * Throws {@link SfTokenError} when `sf` cannot return a token, which the caller surfaces
 * to the UI as "org expired / not logged in — paste a token".
 */
export async function resolveOrgToken(targetOrg: string): Promise<ResolvedSfToken> {
  // Instance URL comes from `sf org display` (the field `show-access-token` may omit),
  // matching SalesforceAuthenticator's proven CLI flow.
  const display = await runSfJson(
    ['org', 'display', '--target-org', targetOrg, '--json'],
    targetOrg
  );
  const instanceUrl = display?.result?.instanceUrl;
  if (!instanceUrl) {
    throw new SfTokenError(`Salesforce CLI did not return an instance URL for "${targetOrg}".`);
  }

  const token = await runSfJson(
    ['org', 'auth', 'show-access-token', '--target-org', targetOrg, '--json'],
    targetOrg
  );
  const accessToken = token?.result?.accessToken;
  if (token?.status !== 0 || !accessToken) {
    throw new SfTokenError(
      token?.message || `Salesforce CLI did not return a token for "${targetOrg}".`
    );
  }
  return { accessToken, instanceUrl };
}

/** Runs an `sf … --json` command and parses it, mapping every failure to SfTokenError. */
async function runSfJson(args: string[], targetOrg: string): Promise<any> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('sf', args, { maxBuffer: MAX_BUFFER }));
  } catch (error: any) {
    const details = error?.stderr?.toString().trim() || error?.message || 'unknown error';
    throw new SfTokenError(`Salesforce CLI failed for "${targetOrg}": ${details}`);
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new SfTokenError(`Salesforce CLI returned an unreadable response for "${targetOrg}".`);
  }
}
