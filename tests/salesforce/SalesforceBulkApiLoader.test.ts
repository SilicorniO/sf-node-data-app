import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppConfiguration } from '../../src/model/AppConfiguration';

const { get, post } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    create: () => ({ get, post }),
  },
}));

import { SalesforceBulkApiLoader } from '../../src/salesforce/SalesforceBulkApiLoader';

describe('SalesforceBulkApiLoader query results', () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    get.mockReset();
    post.mockReset();
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('follows Sforce-Locator pages instead of stopping after the first CSV chunk', async () => {
    post.mockResolvedValue({ data: { id: '750xx' } });
    get.mockImplementation((url: string, config?: { params?: { locator?: string } }) => {
      if (url === '/jobs/query/750xx') {
        return Promise.resolve({
          data: { id: '750xx', state: 'JobComplete', numberRecordsProcessed: 3, numberRecordsFailed: 0 },
        });
      }
      if (url === '/jobs/query/750xx/results' && !config?.params?.locator) {
        return Promise.resolve({
          data: 'Id,Name\n1,One\n2,Two\n',
          headers: { 'sforce-locator': 'next-chunk' },
        });
      }
      if (url === '/jobs/query/750xx/results' && config?.params?.locator === 'next-chunk') {
        return Promise.resolve({
          data: 'Id,Name\n3,Three\n',
          headers: { 'sforce-locator': 'null' },
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    const loader = new SalesforceBulkApiLoader(new AppConfiguration('bulk', null, null, '58.0'));
    const sheet = await loader.query(
      'https://example.my.salesforce.com',
      'token',
      'SELECT Id, Name FROM Account',
      'Accounts'
    );

    expect(sheet.fieldNames).toEqual(['Id', 'Name']);
    expect(sheet.data).toEqual([['1', 'One'], ['2', 'Two'], ['3', 'Three']]);
    expect(get).toHaveBeenCalledWith('/jobs/query/750xx/results', expect.objectContaining({
      params: { maxRecords: 50_000 },
    }));
    expect(get).toHaveBeenCalledWith('/jobs/query/750xx/results', expect.objectContaining({
      params: { maxRecords: 50_000, locator: 'next-chunk' },
    }));
    expect(logs.some(line => line.includes('creating Bulk API v2 query job'))).toBe(true);
    expect(logs.some(line => line.includes('complete'))).toBe(true);
  });
});
