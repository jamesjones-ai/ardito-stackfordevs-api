/**
 * Database Utility
 * PostgreSQL connection pool and query helpers
 */

import { Pool, PoolClient, QueryResult } from 'pg';

// Create connection pool
// Railway provides DATABASE_URL, but we also support individual environment variables for local development
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      }
    : {
        host: process.env.DATABASE_HOST || 'localhost',
        port: parseInt(process.env.DATABASE_PORT || '5432'),
        database: process.env.DATABASE_NAME || 'stackfordevs_db',
        user: process.env.DATABASE_USER || 'postgres',
        password: process.env.DATABASE_PASSWORD || 'postgres',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      }
);

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
  process.exit(-1);
});

/**
 * Execute a query on the database
 * @param text - SQL query text
 * @param params - Query parameters
 * @returns Query result
 */
export async function query<T extends Record<string, any> = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;

    // Log slow queries
    if (duration > 1000) {
      console.warn('Slow query detected:', {
        duration: `${duration}ms`,
        query: text,
        rowCount: res.rowCount,
      });
    }

    return res;
  } catch (error) {
    console.error('Database query error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      query: text,
      params,
    });
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 * Remember to release the client when done!
 * @returns Pool client
 */
export async function getClient(): Promise<PoolClient> {
  return await pool.connect();
}

/**
 * Execute a function within a transaction
 * Automatically handles commit/rollback
 */
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Test database connection
 * @returns true if connected successfully
 */
export async function testConnection(): Promise<boolean> {
  try {
    const result = await query('SELECT NOW() as now');
    console.log('✓ Database connected successfully at', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error);
    return false;
  }
}

/**
 * Close all database connections
 * Call this when shutting down the application
 */
export async function closePool(): Promise<void> {
  await pool.end();
  console.log('Database pool closed');
}

// Export the pool for advanced usage
export { pool };

export default {
  query,
  getClient,
  transaction,
  testConnection,
  closePool,
  pool,
};
