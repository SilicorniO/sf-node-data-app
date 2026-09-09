import { describe, expect, it } from 'vitest';
import { buildCountQuery, decideByCount } from '../../src/salesforce/AutoModeSelector';

describe('decideByCount', () => {
  it('uses the synchronous API below the threshold', () => {
    const decision = decideByCount(9999, 10000);
    expect(decision.method).toBe('api');
    expect(decision.reason).toContain('< 10000');
  });

  it('uses Bulk API at or above the threshold', () => {
    expect(decideByCount(10000, 10000).method).toBe('bulk');
    expect(decideByCount(50000, 10000).method).toBe('bulk');
  });
});

describe('buildCountQuery', () => {
  it('rewrites a simple SELECT into COUNT()', () => {
    expect(buildCountQuery('SELECT Id, Name FROM Account')).toBe('SELECT COUNT() FROM Account');
  });

  it('preserves the WHERE clause', () => {
    expect(buildCountQuery('SELECT Id FROM Contact WHERE LastName = \'Doe\''))
      .toBe('SELECT COUNT() FROM Contact WHERE LastName = \'Doe\'');
  });

  it('drops ORDER BY (it does not affect the count)', () => {
    expect(buildCountQuery('SELECT Id FROM Account WHERE X = 1 ORDER BY Name'))
      .toBe('SELECT COUNT() FROM Account WHERE X = 1');
  });

  it('returns null for aggregate queries', () => {
    expect(buildCountQuery('SELECT COUNT(Id) FROM Account')).toBeNull();
    expect(buildCountQuery('SELECT MAX(Amount) FROM Opportunity')).toBeNull();
  });

  it('returns null for GROUP BY', () => {
    expect(buildCountQuery('SELECT Name FROM Account GROUP BY Name')).toBeNull();
  });

  it('returns null when the query is capped by LIMIT/OFFSET', () => {
    expect(buildCountQuery('SELECT Id FROM Account LIMIT 100')).toBeNull();
    expect(buildCountQuery('SELECT Id FROM Account OFFSET 10')).toBeNull();
  });

  it('returns null for an unrecognized shape', () => {
    expect(buildCountQuery('not a select')).toBeNull();
  });
});
