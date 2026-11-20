import { describe, expect, it } from 'vitest';
import { conditionFailed } from './conditional';

describe('telling "the row was not as expected" from a real failure', () => {
  it('knows the database\'s answer by its type or by its words', () => {
    expect(conditionFailed([{ errorType: 'DynamoDB:ConditionalCheckFailedException', message: 'The conditional request failed (Service: DynamoDb, Status Code: 400)' }])).toBe(true);
    expect(conditionFailed([{ message: 'The conditional request failed' }])).toBe(true);
    expect(conditionFailed([{ errorType: 'DynamoDB:ConditionalCheckFailedException' }])).toBe(true);
  });

  it('leaves every other error a failure', () => {
    expect(conditionFailed([{ errorType: 'Unauthorized', message: 'Not Authorized to access deleteMenuItem on type Mutation' }])).toBe(false);
    expect(conditionFailed([{ message: 'Rate exceeded' }])).toBe(false);
  });

  it('says no when there is no error at all', () => {
    expect(conditionFailed([])).toBe(false);
    expect(conditionFailed(undefined)).toBe(false);
    expect(conditionFailed(null)).toBe(false);
  });
});
