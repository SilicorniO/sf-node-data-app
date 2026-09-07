import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppConfiguration } from '../../src/model/AppConfiguration';

const { get, request } = vi.hoisted(() => ({
  get: vi.fn(),
  request: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    create: () => ({ get, request }),
  },
}));

import { SalesforceApiLoader } from '../../src/salesforce/SalesforceApiLoader';

describe('SalesforceApiLoader query status', () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    get.mockReset();
    request.mockReset();
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs each Query API page while a long synchronous get is running', async () => {
    get
      .mockResolvedValueOnce({
        data: {
          totalSize: 3,
          done: false,
          nextRecordsUrl: '/services/data/v58.0/query/next-page',
          records: [
            { attributes: { type: 'Account' }, Id: '1', Name: 'One' },
            { attributes: { type: 'Account' }, Id: '2', Name: 'Two' },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          totalSize: 3,
          done: true,
          records: [{ attributes: { type: 'Account' }, Id: '3', Name: 'Three' }],
        },
      });

    const loader = new SalesforceApiLoader(new AppConfiguration('api', null, null, '58.0'));
    const sheet = await loader.query('https://example.my.salesforce.com', 'token', 'SELECT Id, Name FROM Account', 'Accounts');

    expect(sheet.data).toHaveLength(3);
    expect(logs.some(line => line.includes('requesting page 1 from the synchronous Query API'))).toBe(true);
    expect(logs.some(line => line.includes('page 1 returned 2 row(s) (2 of 3 total)'))).toBe(true);
    expect(logs.some(line => line.includes('page 2 returned 1 row(s) (3 of 3 total), complete'))).toBe(true);
    expect(get).toHaveBeenNthCalledWith(1, expect.stringContaining('/query?q='), {
      headers: { 'Sforce-Query-Options': 'batchSize=2000' },
    });
    expect(get).toHaveBeenNthCalledWith(2, '/query/next-page', {
      headers: { 'Sforce-Query-Options': 'batchSize=2000' },
    });
  });

  it('sends the configured Query API batch size on each page request', async () => {
    get.mockResolvedValue({
      data: {
        totalSize: 1,
        done: true,
        records: [{ attributes: { type: 'Account' }, Id: '1', Name: 'One' }],
      },
    });

    const loader = new SalesforceApiLoader(new AppConfiguration('api', null, null, '58.0', false, false, 500));
    await loader.query('https://example.my.salesforce.com', 'token', 'SELECT Id, Name FROM Account', 'Accounts');

    expect(get).toHaveBeenCalledWith(expect.stringContaining('/query?q='), {
      headers: { 'Sforce-Query-Options': 'batchSize=500' },
    });
    expect(logs.some(line => line.includes('batchSize 500'))).toBe(true);
  });

  it('logs a heartbeat while a synchronous query page is still in flight', async () => {
    vi.useFakeTimers();
    get.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => {
        resolve({
          data: {
            totalSize: 1,
            done: true,
            records: [{ attributes: { type: 'Account' }, Id: '1', Name: 'One' }],
          },
        });
      }, 10_500);
    }));

    const loader = new SalesforceApiLoader(new AppConfiguration('api', null, null, '58.0'));
    const pending = loader.query(
      'https://example.my.salesforce.com',
      'token',
      'SELECT Id, Name FROM Account',
      'Accounts'
    );

    await vi.advanceTimersByTimeAsync(10_000);
    expect(logs.some(line => line.includes('still waiting for page 1'))).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    const sheet = await pending;
    expect(sheet.data).toHaveLength(1);
  });
});
