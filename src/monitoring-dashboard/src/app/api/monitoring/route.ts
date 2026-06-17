import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// CRITICAL −40 · HIGH −15 · MODERATE −5 · LOW −2 · ×1.5 if direct dependency
const SEVERITY_WEIGHTS: Record<string, number> = { critical: 40, high: 15, moderate: 5, low: 2 };

const G = 'gold';
const S = 'default';

const ECO = `dep.ecosystem`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawId = searchParams.get('repo_id') ?? '';
  const repoId = UUID_RE.test(rawId) ? rawId : null;

  try {
    // ── 1. Summary ────────────────────────────────────────────────
    const summaryQuery = repoId
      ? `
        SELECT
          (SELECT count() FROM ${G}.dim_advisory)                       AS total_advisories,
          uniq(f.dependency_key, f.advisory_id)                         AS total_vulns,
          uniq(f.dependency_key)                                         AS total_deps,
          uniqIf(f.dependency_key, r.depth = 1)                         AS direct_vulns,
          uniqIf(f.dependency_key, r.depth > 1)                         AS indirect_vulns
        FROM ${G}.fact_vulnerability_scan f
        JOIN ${G}.dim_dependency dep ON f.dependency_key = dep.unique_id
        JOIN (
          SELECT child_id, min(depth) AS depth
          FROM ${S}.silver_dependency_relations
          WHERE parent_id = '${repoId}'
          GROUP BY child_id
        ) r ON r.child_id = toString(dep.dependency_id)
        WHERE f.repo_id = toUUID('${repoId}')
      `
      : `
        SELECT
          (SELECT count() FROM ${G}.dim_advisory)                       AS total_advisories,
          uniq(f.dependency_key, f.advisory_id)                         AS total_vulns,
          uniq(f.dependency_key)                                         AS total_deps,
          0                                                              AS direct_vulns,
          0                                                              AS indirect_vulns
        FROM ${G}.fact_vulnerability_scan f
      `;

    // ── 2. Triage ─────────────────────────────────────────────────
    const triageQuery = `
      SELECT
        dep.name,
        ${ECO}                                                           AS ecosystem,
        ${repoId ? `min(r.depth)` : `0`}                                AS depth,
        uniq(f.advisory_id)                                              AS advisory_count,
        toString(max(a.severity_label))                                  AS severity,
        argMax(f.advisory_id,  a.severity_label)                         AS advisory_id,
        argMax(a.cve_id,       a.severity_label)                         AS cve_id,
        max(f.severity_score)                                            AS max_cvss,
        max(f.has_patch)                                                 AS has_patch,
        argMax(a.summary,      a.severity_label)                         AS summary,
        anyIf(vuln.first_patched_version, isNotNull(vuln.first_patched_version)) AS recommended_fix
      FROM ${G}.fact_vulnerability_scan f
      JOIN ${G}.dim_dependency dep ON f.dependency_key = dep.unique_id
      JOIN ${G}.dim_advisory a ON f.advisory_id = a.advisory_id
      LEFT JOIN ${S}.silver_github_advisories_vulnerabilities vuln
        ON a.internal_id = vuln._dlt_parent_id
       AND dep.name = vuln.package__name
      ${repoId
        ? `JOIN (
            SELECT child_id, min(depth) AS depth
            FROM ${S}.silver_dependency_relations
            WHERE parent_id = '${repoId}'
            GROUP BY child_id
          ) r ON r.child_id = toString(dep.dependency_id)`
        : ''}
      ${repoId ? `WHERE f.repo_id = toUUID('${repoId}')` : ''}
      GROUP BY dep.name, ecosystem
      ORDER BY max(a.severity_label) DESC, max(f.severity_score) DESC
      LIMIT 100
    `;

    // ── 3. Severity distribution ──────────────────────────────────
    const distributionQuery = `
      SELECT
        toString(a.severity_label)                    AS severity_label,
        uniq(f.dependency_key, f.advisory_id)         AS count
      FROM ${G}.fact_vulnerability_scan f
      JOIN ${G}.dim_advisory a ON f.advisory_id = a.advisory_id
      ${repoId ? `WHERE f.repo_id = toUUID('${repoId}')` : ''}
      GROUP BY a.severity_label
      ORDER BY a.severity_label DESC
    `;

    const [summaryCursor, triageCursor, distributionCursor] = await Promise.all([
      clickhouse.query({ query: summaryQuery,      format: 'JSONEachRow' }),
      clickhouse.query({ query: triageQuery,       format: 'JSONEachRow' }),
      clickhouse.query({ query: distributionQuery, format: 'JSONEachRow' }),
    ]);

    const [summaryData, triageData, distributionData] = await Promise.all([
      summaryCursor.json()      as Promise<any[]>,
      triageCursor.json()       as Promise<any[]>,
      distributionCursor.json() as Promise<any[]>,
    ]);

    // ── 4. Inventory (focused only) ───────────────────────────────
    let inventoryData: any[] = [];
    if (repoId) {
      const inv = await clickhouse.query({
        query: `
          SELECT
            dep.name,
            ${ECO}          AS ecosystem,
            min(r.depth)    AS depth,
            max(f.is_vulnerable)                        AS is_vulnerable
          FROM ${S}.silver_dependency_relations r
          JOIN ${G}.dim_dependency dep ON r.child_id = toString(dep.dependency_id)
          LEFT JOIN ${G}.fact_vulnerability_scan f
            ON f.dependency_key = dep.unique_id
           AND f.repo_id = toUUID('${repoId}')
          WHERE r.parent_id = '${repoId}'
          GROUP BY dep.name, ecosystem
          ORDER BY min(r.depth) ASC, dep.name ASC
        `,
        format: 'JSONEachRow',
      });
      inventoryData = await inv.json() as any[];
    }

    // ── 5. Health Score ───────────────────────────────────────────
    const penalty = triageData.reduce((sum, t) => {
      const w = SEVERITY_WEIGHTS[t.severity as string] ?? 0;
      const coeff = Number(t.depth) === 1 ? 1.5 : 1.0;
      return sum + w * coeff;
    }, 0);
    const health_score = Math.max(0, 100 - Math.min(100, penalty));

    return NextResponse.json({
      summary: {
        ...(summaryData[0] ?? {
          total_advisories: 0,
          total_vulns: 0,
          total_deps: 0,
          direct_vulns: 0,
          indirect_vulns: 0,
        }),
        health_score,
      },
      distribution: distributionData,
      triage: triageData,
      inventory: inventoryData,
      isFocused: !!repoId,
    });
  } catch (error: any) {
    console.error('ClickHouse error:', error);
    return NextResponse.json({ error: error.message ?? 'Failed to fetch data' }, { status: 500 });
  }
}
