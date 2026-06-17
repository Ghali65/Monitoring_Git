import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse';

export async function GET() {
  try {
    const cursor = await clickhouse.query({
      query: `
        SELECT DISTINCT
          toString(repo_id) as repo_id,
          repo_name as name
        FROM gold.dim_repository
        ORDER BY name ASC
      `,
      format: 'JSONEachRow',
    });
    const repos = await cursor.json();
    return NextResponse.json(repos);
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
