import { openDb, type DB } from '@server/store/db.js';

export function makeTestDb(): DB {
  return openDb(':memory:');
}
