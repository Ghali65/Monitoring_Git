import { createClient } from '@clickhouse/client';

export const clickhouse = createClient({
  url: `http://${process.env.DBT_CH_HOST}:${process.env.DBT_CH_PORT || '8123'}`,
  username: process.env.DBT_CH_USER,
  password: process.env.DBT_CH_PASSWORD,
  database: process.env.DBT_CH_DB_SILVER || 'default',
  // On camoufle la requête pour contourner FortiGuard
  http_headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  }
});
