import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// CRITICAL −40 · HIGH −15 · MODERATE −5 · LOW −2 · ×1.5 if direct dependency
const SEVERITY_WEIGHTS: Record<string, number> = { critical: 40, high: 15, moderate: 5, low: 2 };

const G = 'gold';
const S = 'default';

const ECO = `dep.ecosystem`;

interface RawVuln {
  repo_id: string;
  dependency_key: string;
  name: string;
  version: string | null;
  ecosystem: string;
  depth: number;
  advisory_id: string;
  cve_id: string;
  severity: string;
  max_cvss: number;
  has_patch: number;
  summary: string;
  recommended_fix: string | null;
  detected_at: string;
}

function isVulnerable(installed: string | null, patched: string | null): boolean {
  if (!installed || !patched) return true;
  const iMatch = installed.match(/([0-9]+\.[0-9]+\.[0-9]+|[0-9]+\.[0-9]+|[0-9]+)/);
  const pMatch = patched.match(/([0-9]+\.[0-9]+\.[0-9]+|[0-9]+\.[0-9]+|[0-9]+)/);
  if (!iMatch || !pMatch) return true;
  
  const iParts = iMatch[1].split('.').map(n => parseInt(n, 10) || 0);
  const pParts = pMatch[1].split('.').map(n => parseInt(n, 10) || 0);
  
  for (let i = 0; i < Math.max(iParts.length, pParts.length); i++) {
    const iv = iParts[i] || 0;
    const pv = pParts[i] || 0;
    if (iv > pv) return false;
    if (iv < pv) return true;
  }
  return false;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawId = searchParams.get('repo_id') ?? '';
  const repoId = UUID_RE.test(rawId) ? rawId : null;

  try {
    const rawQuery = `
      SELECT
        f.repo_id,
        f.dependency_key,
        dep.name,
        dep.version,
        ${ECO} AS ecosystem,
        ${repoId ? 'r.depth' : '0'} AS depth,
        f.advisory_id,
        a.cve_id,
        a.severity_label AS severity,
        f.severity_score AS max_cvss,
        f.has_patch,
        a.summary,
        vuln.first_patched_version AS recommended_fix,
        f.detected_at
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
    `;

    const rawCursor = await clickhouse.query({ query: rawQuery, format: 'JSONEachRow' });
    const rawData = await rawCursor.json() as RawVuln[];

    // Process logic in JS
    const latestMap = new Map<string, RawVuln>();
    for (const row of rawData) {
      if (!isVulnerable(row.version, row.recommended_fix)) continue;
      
      const key = `${row.repo_id}|${row.dependency_key}|${row.advisory_id}`;
      const existing = latestMap.get(key);
      if (!existing || new Date(row.detected_at) > new Date(existing.detected_at)) {
        latestMap.set(key, row);
      }
    }
    const filteredVulns = Array.from(latestMap.values());

    const totalAdvisoriesCursor = await clickhouse.query({ query: `SELECT count() as c FROM ${G}.dim_advisory`, format: 'JSONEachRow' });
    const totalAdvisoriesData = await totalAdvisoriesCursor.json() as any[];
    const total_advisories = Number(totalAdvisoriesData[0]?.c || 0);

    const uniqueAdvisories = new Set(filteredVulns.map(v => `${v.dependency_key}|${v.advisory_id}`));
    const uniqueDeps = new Set(filteredVulns.map(v => v.dependency_key));
    let direct_vulns = 0;
    let indirect_vulns = 0;

    if (repoId) {
      const directDeps = new Set(filteredVulns.filter(v => Number(v.depth) === 1).map(v => v.dependency_key));
      const indirectDeps = new Set(filteredVulns.filter(v => Number(v.depth) > 1).map(v => v.dependency_key));
      direct_vulns = directDeps.size;
      indirect_vulns = indirectDeps.size;
    }

    const summaryData = {
      total_advisories,
      total_vulns: uniqueAdvisories.size,
      total_deps: uniqueDeps.size,
      direct_vulns,
      indirect_vulns,
    };

    // Distribution
    const distMap: Record<string, Set<string>> = {};
    for (const v of filteredVulns) {
      const sev = v.severity || 'unknown';
      if (!distMap[sev]) distMap[sev] = new Set();
      distMap[sev].add(`${v.dependency_key}|${v.advisory_id}`);
    }
    const distributionData = Object.entries(distMap).map(([severity_label, set]) => ({
      severity_label,
      count: set.size
    })).sort((a, b) => b.count - a.count);

    // Triage
    const triageMap = new Map<string, any>();
    for (const v of filteredVulns) {
      const key = `${v.name}|${v.ecosystem}`;
      const existing = triageMap.get(key);
      if (!existing) {
        triageMap.set(key, {
          name: v.name,
          ecosystem: v.ecosystem,
          depth: v.depth,
          advisories: new Set([v.advisory_id]),
          severity: v.severity,
          advisory_id: v.advisory_id,
          cve_id: v.cve_id,
          max_cvss: v.max_cvss,
          has_patch: v.has_patch,
          summary: v.summary,
          recommended_fix: v.recommended_fix
        });
      } else {
        existing.advisories.add(v.advisory_id);
        const weightNew = SEVERITY_WEIGHTS[v.severity?.toLowerCase()] || 0;
        const weightOld = SEVERITY_WEIGHTS[existing.severity?.toLowerCase()] || 0;
        
        if (weightNew > weightOld || (weightNew === weightOld && Number(v.max_cvss) > Number(existing.max_cvss))) {
          existing.severity = v.severity;
          existing.advisory_id = v.advisory_id;
          existing.cve_id = v.cve_id;
          existing.max_cvss = v.max_cvss;
          existing.summary = v.summary;
        }
        existing.has_patch = Math.max(Number(existing.has_patch), Number(v.has_patch));
        if (v.recommended_fix) existing.recommended_fix = v.recommended_fix;
        existing.depth = Math.min(Number(existing.depth), Number(v.depth));
      }
    }

    const triageData = Array.from(triageMap.values()).map(t => {
      const advCount = t.advisories.size;
      delete t.advisories;
      return { ...t, advisory_count: advCount };
    }).sort((a, b) => {
      const wA = SEVERITY_WEIGHTS[a.severity?.toLowerCase()] || 0;
      const wB = SEVERITY_WEIGHTS[b.severity?.toLowerCase()] || 0;
      if (wA !== wB) return wB - wA;
      return (Number(b.max_cvss) || 0) - (Number(a.max_cvss) || 0);
    }).slice(0, 100);

    // Inventory
    let inventoryData: any[] = [];
    if (repoId) {
      const inv = await clickhouse.query({
        query: `
          SELECT
            dep.unique_id   AS dependency_key,
            dep.name,
            ${ECO}          AS ecosystem,
            min(r.depth)    AS depth
          FROM ${S}.silver_dependency_relations r
          JOIN ${G}.dim_dependency dep ON r.child_id = toString(dep.dependency_id)
          WHERE r.parent_id = '${repoId}'
          GROUP BY dep.unique_id, dep.name, ecosystem
          ORDER BY min(r.depth) ASC, dep.name ASC
        `,
        format: 'JSONEachRow',
      });
      const invRaw = await inv.json() as any[];
      inventoryData = invRaw.map(r => ({
        ...r,
        is_vulnerable: uniqueDeps.has(r.dependency_key) ? 1 : 0
      }));
    }

    // Health Score
    const penalty = triageData.reduce((sum, t) => {
      const w = SEVERITY_WEIGHTS[t.severity?.toLowerCase() as string] ?? 0;
      const coeff = Number(t.depth) === 1 ? 1.5 : 1.0;
      return sum + w * coeff;
    }, 0);
    const health_score = Math.max(0, 100 - Math.min(100, penalty));

    return NextResponse.json({
      summary: {
        ...summaryData,
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
