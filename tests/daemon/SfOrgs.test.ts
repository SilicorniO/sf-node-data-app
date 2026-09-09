import { afterEach, describe, expect, it, vi } from 'vitest';

// execFile is consumed via promisify(execFile); the mock uses the standard
// (args..., callback) node signature so promisify wraps it correctly.
const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('child_process', () => ({ execFile }));

import { listOrgs, resolveOrgToken, SfTokenError } from '../../src/daemon/SfOrgs';

/** Queue stdout/err responses (or errors) matched to sequential execFile calls. */
function queueResponses(responses: Array<{ stdout?: string; error?: any }>) {
  let call = 0;
  execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
    const response = responses[call++] ?? { stdout: '' };
    if (response.error) cb(response.error);
    else cb(null, { stdout: response.stdout ?? '', stderr: '' });
  });
}

afterEach(() => {
  execFile.mockReset();
});

describe('listOrgs', () => {
  it('reports unavailable when sf is missing', async () => {
    queueResponses([{ error: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) }]);
    const result = await listOrgs();
    expect(result.sfAvailable).toBe(false);
    expect(result.orgs).toEqual([]);
  });

  it('flattens org groups, de-duplicates, and marks the default first', async () => {
    queueResponses([{
      stdout: JSON.stringify({
        status: 0,
        result: {
          nonScratchOrgs: [
            { alias: 'prod', username: 'a@example.com', instanceUrl: 'https://a', isDefaultUsername: false },
            { alias: 'dev', username: 'b@example.com', instanceUrl: 'https://b', isDefaultUsername: true },
          ],
          sandboxes: [
            { alias: 'dev', username: 'b@example.com', instanceUrl: 'https://b' }, // duplicate
          ],
          other: 'ignored-non-array',
        },
      }),
    }]);
    const { sfAvailable, orgs } = await listOrgs();
    expect(sfAvailable).toBe(true);
    expect(orgs).toHaveLength(2);
    expect(orgs[0]).toMatchObject({ alias: 'dev', isDefault: true });
    expect(orgs[1]).toMatchObject({ alias: 'prod', isDefault: false });
  });
});

describe('resolveOrgToken', () => {
  it('returns instance URL from org display and token from show-access-token', async () => {
    queueResponses([
      { stdout: JSON.stringify({ status: 0, result: { instanceUrl: 'https://x.my.salesforce.com' } }) },
      { stdout: JSON.stringify({ status: 0, result: { accessToken: 'tok-123' } }) },
    ]);
    const token = await resolveOrgToken('my-org');
    expect(token).toEqual({ accessToken: 'tok-123', instanceUrl: 'https://x.my.salesforce.com' });
  });

  it('throws SfTokenError when the CLI errors (expired / not logged in)', async () => {
    queueResponses([
      { stdout: JSON.stringify({ status: 0, result: { instanceUrl: 'https://x' } }) },
      { error: Object.assign(new Error('exit 1'), { stderr: 'No authorization information found' }) },
    ]);
    await expect(resolveOrgToken('my-org')).rejects.toBeInstanceOf(SfTokenError);
  });

  it('throws SfTokenError when no token is returned', async () => {
    queueResponses([
      { stdout: JSON.stringify({ status: 0, result: { instanceUrl: 'https://x' } }) },
      { stdout: JSON.stringify({ status: 0, result: {} }) },
    ]);
    await expect(resolveOrgToken('my-org')).rejects.toBeInstanceOf(SfTokenError);
  });
});
