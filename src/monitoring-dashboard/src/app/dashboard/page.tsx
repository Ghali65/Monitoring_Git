"use client";

import { useEffect, useState } from 'react';
import {
  Shield, GitBranch, Package, AlertTriangle, Database,
  CheckCircle, ExternalLink, Terminal, ArrowRight,
  Layers, Zap, Search, Filter, Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';

/* ── Types ───────────────────────────────────────────────────────── */

interface Summary {
  health_score: number;
  total_advisories: number;
  total_vulns: number;
  total_deps: number;
  direct_vulns: number;
  indirect_vulns: number;
}

interface TriageItem {
  name: string;
  ecosystem: string;
  depth: number;
  advisory_count: number;
  advisory_id: string;
  cve_id: string;
  severity: 'critical' | 'high' | 'moderate' | 'low';
  max_cvss: number | null;
  has_patch: number;
  summary: string;
  recommended_fix: string | null;
}

interface Distribution {
  severity_label: string;
  count: number;
}

interface InventoryItem {
  name: string;
  ecosystem: string;
  depth: number;
  is_vulnerable: number;
}

interface DashboardData {
  summary: Summary;
  triage: TriageItem[];
  distribution: Distribution[];
  inventory: InventoryItem[];
  isFocused: boolean;
}

interface Repo {
  repo_id: string;
  name: string;
}

/* ── Constants ───────────────────────────────────────────────────── */

const SEVERITIES = ['critical', 'high', 'moderate', 'low'] as const;

const SEV_LABELS: Record<string, string> = {
  critical: 'Critique', high: 'Élevé', moderate: 'Modéré', low: 'Faible',
};

const ECO_COLORS: Record<string, [string, string]> = {
  npm:           ['#CB3837', 'rgba(203,56,55,0.12)'],
  pypi:          ['#4B8BBE', 'rgba(75,139,190,0.12)'],
  maven:         ['#C71A36', 'rgba(199,26,54,0.12)'],
  githubactions: ['#2088FF', 'rgba(32,136,255,0.12)'],
  go:            ['#00ACD7', 'rgba(0,172,215,0.12)'],
  rubygems:      ['#CC342D', 'rgba(204,52,45,0.12)'],
  nuget:         ['#5C2D91', 'rgba(92,45,145,0.12)'],
  composer:      ['#F28D1A', 'rgba(242,141,26,0.12)'],
  cargo:         ['#DEA584', 'rgba(222,165,132,0.12)'],
  unknown:       ['#5A5A7A', 'rgba(90,90,122,0.10)'],
};

/* ── Helpers ─────────────────────────────────────────────────────── */

const PRE_RELEASE_PATTERN = /-(?:rc|beta|alpha|next|canary|dev|pre)\./i;

const PRE_RELEASE_META: Record<string, { label: string; risk: 'danger' | 'warning' }> = {
  next:   { label: 'NEXT',   risk: 'danger'  },
  alpha:  { label: 'ALPHA',  risk: 'danger'  },
  canary: { label: 'CANARY', risk: 'danger'  },
  dev:    { label: 'DEV',    risk: 'danger'  },
  rc:     { label: 'RC',     risk: 'warning' },
  beta:   { label: 'BETA',   risk: 'warning' },
  pre:    { label: 'PRE',    risk: 'warning' },
};

const PRE_RELEASE_MESSAGES: Record<'danger' | 'warning', string> = {
  danger:  'Version de développement instable — Non recommandé en production',
  warning: 'Version pre-release — Valider la compatibilité avant installation',
};

function isPreRelease(version: string): { isPreRelease: boolean; label: string | null; risk: 'danger' | 'warning' | null } {
  const match = version.match(PRE_RELEASE_PATTERN);
  if (!match) return { isPreRelease: false, label: null, risk: null };
  const key = match[0].replace(/[-\.]/g, '').toLowerCase();
  const meta = PRE_RELEASE_META[key] ?? { label: key.toUpperCase(), risk: 'warning' as const };
  return { isPreRelease: true, label: meta.label, risk: meta.risk };
}

function scoreColor(s: number) {
  if (s < 50) return 'var(--critical)';
  if (s < 80) return 'var(--moderate)';
  return 'var(--safe)';
}

function scoreLabel(s: number) {
  if (s < 50) return 'Critique';
  if (s < 80) return 'À risque';
  return 'Sain';
}

function contextMessage(data: DashboardData | null): string {
  if (!data?.isFocused) return "Sélectionnez un dépôt pour obtenir l'analyse de sécurité de ses dépendances.";
  const s = data.summary;
  if (!s.total_vulns) return "Aucun vecteur d'attaque connu détecté. Ce dépôt est propre vis-à-vis de la base GHSA.";
  const criticals = data.distribution.find(d => d.severity_label === 'critical');
  if (criticals && Number(criticals.count) > 0)
    return `${criticals.count} advisory critique${Number(criticals.count) > 1 ? 's' : ''} détecté${Number(criticals.count) > 1 ? 's' : ''}. Risque d'exploitation immédiat — patcher en priorité.`;
  if (s.direct_vulns > 0)
    return `${s.direct_vulns} dépendance${s.direct_vulns > 1 ? 's' : ''} directe${s.direct_vulns > 1 ? 's' : ''} vulnérable${s.direct_vulns > 1 ? 's' : ''}. Action recommandée avant le prochain déploiement.`;
  return "Vulnérabilités transitives uniquement. Risque indirect — surveiller et planifier la remédiation.";
}

/* ── Sub-components ──────────────────────────────────────────────── */

function SevBadge({ sev }: { sev: string }) {
  return <span className={`badge badge-${sev}`}>{SEV_LABELS[sev] ?? sev}</span>;
}

function DepthBadge({ depth }: { depth: number }) {
  if (!depth) return null;
  return (
    <span className={`badge ${depth === 1 ? 'badge-direct' : 'badge-transitive'}`}>
      {depth === 1 ? 'Direct' : 'Transitif'}
    </span>
  );
}

function CvssScore({ cvss }: { cvss: number | null }) {
  const score = cvss != null ? Number(cvss) : null;
  if (!score || score <= 0) {
    return (
      <span className="cvss-na" title="Score CVSS non disponible pour cette advisory">
        CVSS N/A
      </span>
    );
  }
  const color =
    score >= 9.0 ? 'var(--critical)' :
    score >= 7.0 ? 'var(--high)'     :
    score >= 4.0 ? 'var(--moderate)' :
                   'var(--safe)';
  return (
    <span className="issue-cvss" style={{ color }}>
      CVSS {score.toFixed(1)}
    </span>
  );
}

function InvDepthBadge({ depth }: { depth: number }) {
  if (depth === 1) return <span className="badge badge-direct">Direct</span>;
  return <span className="badge badge-transitive">Transitif N{depth}</span>;
}

function EcoBadge({ eco }: { eco: string }) {
  const key = eco.toLowerCase();
  const [fg, bg] = ECO_COLORS[key] ?? ECO_COLORS.unknown;
  const label = key === 'githubactions' ? 'actions' : eco;
  return (
    <span className="badge" style={{ color: fg, background: bg, borderColor: `${fg}30` }}>
      {label}
    </span>
  );
}

/* ── Score weights (mirrors route.ts) ───────────────────────────── */

const SCORE_WEIGHTS: Record<string, number> = { critical: 40, high: 15, moderate: 5, low: 2 };

/* ── Score Tooltip ───────────────────────────────────────────────── */

function ScoreTooltip({ triage, score }: { triage: TriageItem[]; score: number }) {
  const lines = triage.map(t => {
    const w    = SCORE_WEIGHTS[t.severity] ?? 0;
    const coeff = Number(t.depth) === 1 ? 1.5 : 1.0;
    return { name: t.name, severity: t.severity, depth: Number(t.depth), penalty: w * coeff };
  });

  const rawPenalty   = lines.reduce((s, l) => s + l.penalty, 0);
  const cappedPenalty = Math.min(rawPenalty, 100);
  const visible      = lines.slice(0, 8);
  const hidden       = lines.length - visible.length;

  return (
    <div className="score-tooltip">
      <div className="st-header">
        <span className="st-title">Score de Santé — Détail</span>
      </div>

      <div className="st-formula-rule">
        <span>Base : <b>100 pts</b></span>
        <span className="st-rule-badges">
          <span className="badge badge-critical">−40</span>
          <span className="badge badge-high">−15</span>
          <span className="badge badge-moderate">−5</span>
          <span className="badge badge-low">−2</span>
          <span className="badge badge-direct">×1.5 direct</span>
        </span>
      </div>

      {lines.length === 0 ? (
        <div className="st-empty">Aucune vulnérabilité — score parfait ✓</div>
      ) : (
        <>
          <div className="st-lines">
            {visible.map((l, i) => (
              <div key={i} className="st-line">
                <span className="st-pkg" title={l.name}>{l.name}</span>
                <span className={`badge badge-${l.severity}`}>{l.severity.toUpperCase()}</span>
                <span className="st-type">{l.depth === 1 ? 'direct ×1.5' : 'transitif ×1'}</span>
                <span className="st-pts">−{l.penalty % 1 === 0 ? l.penalty : l.penalty.toFixed(1)} pts</span>
              </div>
            ))}
            {hidden > 0 && (
              <div className="st-more">+{hidden} autre{hidden > 1 ? 's' : ''} package{hidden > 1 ? 's' : ''}…</div>
            )}
          </div>

          <div className="st-total">
            <span>Pénalité totale</span>
            <span className="st-total-val">−{cappedPenalty % 1 === 0 ? cappedPenalty : cappedPenalty.toFixed(1)} pts{rawPenalty > 100 ? ' (plafonnée)' : ''}</span>
          </div>
          <div className="st-result">
            max(0, 100 − {cappedPenalty % 1 === 0 ? cappedPenalty : cappedPenalty.toFixed(1)}) = <b>{score}</b>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Health Gauge (half-circle) ──────────────────────────────────── */

function HealthGauge({ score, triage }: { score: number; triage: TriageItem[] }) {
  const [hover, setHover] = useState(false);
  const color = scoreColor(score);
  const fill  = score / 100;

  return (
    <div
      className="health-gauge-wrap"
      onMouseEnter={() => { console.log('HOVER IN'); setHover(true); }}
      onMouseLeave={() => { console.log('HOVER OUT'); setHover(false); }}
    >
      <div className="health-gauge">
        <svg viewBox="0 0 190 108" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M 18 95 A 77 77 0 0 1 172 95"
            stroke="var(--surface-3)"
            strokeWidth="13"
            strokeLinecap="round"
          />
          <motion.path
            d="M 18 95 A 77 77 0 0 1 172 95"
            stroke={color}
            strokeWidth="13"
            strokeLinecap="round"
            pathLength="1"
            initial={{ strokeDasharray: '0 1' }}
            animate={{ strokeDasharray: `${fill} 1` }}
            transition={{ duration: 1.4, ease: [0.34, 1.1, 0.64, 1] }}
            style={{ filter: `drop-shadow(0 0 8px ${color}60)` }}
          />
          <motion.text
            x="95" y="90"
            textAnchor="middle" dominantBaseline="middle"
            fontSize="38" fontWeight="900"
            fill={color} fontFamily="Outfit, sans-serif"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.4 }}
          >
            {score}
          </motion.text>
          <text x="14"  y="107" fontSize="9" fill="var(--fg-subtle)" textAnchor="middle">0</text>
          <text x="176" y="107" fontSize="9" fill="var(--fg-subtle)" textAnchor="middle">100</text>
        </svg>
        <div className="health-status" style={{ color }}>{scoreLabel(score)}</div>
        <div className="health-hint">Survoler pour le détail</div>
      </div>

      {hover && (
        <div className="score-tooltip-wrap">
          <ScoreTooltip triage={triage} score={score} />
        </div>
      )}
    </div>
  );
}

/* ── Issue card ──────────────────────────────────────────────────── */

function IssueCard({ item, index, onCopy, copied }: {
  item: TriageItem;
  index: number;
  onCopy: (i: number, name: string, fix: string) => void;
  copied: number | null;
}) {
  const hasPatch  = !!item.recommended_fix;
  const preInfo   = hasPatch ? isPreRelease(item.recommended_fix!) : { isPreRelease: false, label: null, risk: null };
  const ghsaUrl   = `https://github.com/advisories/${item.advisory_id}`;

  return (
    <motion.div
      className="issue-card"
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03, duration: 0.22 }}
    >
      <div className={`issue-stripe ${item.severity}`} />
      <div className="issue-body">

        {/* Top row */}
        <div className="issue-top">
          <div className="issue-identity">
            <div className="issue-avatar">{item.name.charAt(0).toUpperCase()}</div>
            <div style={{ minWidth: 0 }}>
              <div className="issue-name">{item.name}</div>
              <div className="issue-meta">
                <EcoBadge eco={item.ecosystem} />
                <DepthBadge depth={item.depth} />
                {Number(item.advisory_count) > 1 && (
                  <span className="badge badge-cve-count">{item.advisory_count} CVE</span>
                )}
                {item.cve_id && <span className="issue-cve">{item.cve_id}</span>}
              </div>
            </div>
          </div>
          <div className="issue-right">
            <SevBadge sev={item.severity} />
            <CvssScore cvss={item.max_cvss} />
          </div>
        </div>

        {/* Summary */}
        {item.summary && <p className="issue-summary">{item.summary}</p>}

        {/* Footer */}
        <div className="issue-footer">
          <div className="issue-footer-left">
            <div className="version-flow">
              <a href={ghsaUrl} target="_blank" rel="noopener noreferrer" className="ghsa-link">
                {item.advisory_id} <ExternalLink size={9} />
              </a>
              {hasPatch && (
                <>
                  <ArrowRight size={10} style={{ color: 'var(--fg-subtle)' }} />
                  <span className="version-chip patched">v{item.recommended_fix}</span>
                  {preInfo.isPreRelease && (
                    <span className={`badge badge-prerelease-${preInfo.risk}`}>{preInfo.label}</span>
                  )}
                </>
              )}
            </div>
            {preInfo.isPreRelease && preInfo.risk && (
              <div className={`prerelease-warning prerelease-warning-${preInfo.risk}`}>
                ⚠️ {PRE_RELEASE_MESSAGES[preInfo.risk]}
              </div>
            )}
          </div>
          <button
            className={`copy-btn${copied === index ? ' copied' : ''}${preInfo.isPreRelease && copied !== index ? ` prerelease-${preInfo.risk}` : ''}`}
            disabled={!hasPatch}
            onClick={() => hasPatch && onCopy(index, item.name, item.recommended_fix!)}
          >
            <Terminal size={10} />
            {copied === index ? 'Copié !' : hasPatch ? 'Copier fix' : 'Pas de patch'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ── Main Dashboard ──────────────────────────────────────────────── */

export default function Dashboard() {
  const [data, setData]           = useState<DashboardData | null>(null);
  const [repos, setRepos]         = useState<Repo[]>([]);
  const [selected, setSelected]   = useState('');
  const [loading, setLoading]     = useState(true);
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);
  const [copied, setCopied]       = useState<number | null>(null);
  const [invSearch, setInvSearch] = useState('');
  const [showVulnOnly, setShowVulnOnly] = useState(false);
  const [aiAnalysis, setAiAnalysis]     = useState<string | null>(null);
  const [aiLoading, setAiLoading]       = useState(false);

  useEffect(() => {
    fetch('/api/repositories')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setRepos(d); })
      .catch(console.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    setErrorMsg(null);
    setInvSearch('');
    setShowVulnOnly(false);
    setAiAnalysis(null);
    const url = selected ? `/api/monitoring?repo_id=${selected}` : '/api/monitoring';
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (d && d.error) {
          setErrorMsg(d.error);
        } else if (d) {
          setData(d);
          if (d.isFocused) triggerAiAnalysis(d, selected);
        }
        setLoading(false);
      })
      .catch(e => {
        setErrorMsg(e.message || "Erreur réseau ou API injoignable");
        setLoading(false);
      });
  }, [selected]);

  function triggerAiAnalysis(d: DashboardData, repoId: string) {
    const repo = repos.find(r => r.repo_id === repoId);
    setAiLoading(true);
    fetch('/api/analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoName:     repo?.name ?? repoId,
        summary:      d.summary,
        triage:       d.triage,
        distribution: d.distribution,
      }),
    })
      .then(r => r.json())
      .then(r => { setAiAnalysis(r.analysis ?? null); setAiLoading(false); })
      .catch(() => setAiLoading(false));
  }

  function handleCopy(i: number, name: string, fix: string) {
    navigator.clipboard.writeText(`npm install ${name}@${fix}`);
    setCopied(i);
    setTimeout(() => setCopied(null), 2000);
  }

  const s = data?.summary ?? {} as Summary;
  const score = s.health_score ?? 100;
  const totalDist = data?.distribution?.reduce((a, d) => a + Number(d.count), 0) || 1;

  // Triage grouped by severity (only groups that have items)
  const grouped = SEVERITIES
    .map(sev => ({ sev, items: (data?.triage ?? []).filter(t => t.severity === sev) }))
    .filter(g => g.items.length > 0);

  // Inventory filtered by search and vuln toggle
  const filteredInventory = (data?.inventory ?? []).filter(dep => {
    const matchSearch = !invSearch || dep.name.toLowerCase().includes(invSearch.toLowerCase());
    const matchVuln   = !showVulnOnly || dep.is_vulnerable;
    return matchSearch && matchVuln;
  });
  const vulnCount = (data?.inventory ?? []).filter(d => d.is_vulnerable).length;

  let cardIndex = 0;

  return (
    <div className="page">

      {/* ── HEADER ──────────────────────────────────────────── */}
      <header className="header">
        <Link href="/" className="header-brand" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Image src="/logo.png" alt="Logo" width={32} height={32} style={{ objectFit: 'contain' }} />
          <div className="brand-name" style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, padding: 0 }}>
            Git<span style={{ color: 'var(--primary)' }}>Monitoring</span>
          </div>
        </Link>

        <div className="header-controls">
          <div className="repo-select-wrap">
            <GitBranch />
            <select
              className="repo-select"
              value={selected}
              onChange={e => setSelected(e.target.value)}
            >
              <option value="">Vue globale de l&apos;écosystème</option>
              {repos.map(r => (
                <option key={r.repo_id} value={r.repo_id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="live-badge">
            <div className="live-dot" />
            <span className="live-label">Live</span>
          </div>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            className="loading-wrap"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <div className="spinner" />
            <span className="loading-label">Interrogation de ClickHouse…</span>
          </motion.div>
        ) : (
          <motion.div
            key={selected || 'global'}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
          >

            {/* ── ERROR MESSAGE ─────────────────────────────────────── */}
            {errorMsg && (
              <div style={{ padding: '2rem', background: 'var(--critical-dim)', border: '1px solid var(--critical)', borderRadius: '12px', color: 'var(--critical)', marginBottom: '1rem' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertTriangle size={20} />
                  Erreur de connexion à la base de données ClickHouse
                </h3>
                <p style={{ margin: 0, fontFamily: 'monospace' }}>{errorMsg}</p>
                <p style={{ margin: '1rem 0 0 0', fontSize: '0.9rem', opacity: 0.8 }}>
                  Le conteneur Next.js n'arrive pas à joindre ClickHouse. Vérifiez que la variable DBT_CH_HOST correspond au nom du conteneur ClickHouse sur Coolify.
                </p>
              </div>
            )}

            {/* ── KPI ROW ─────────────────────────────────────── */}
            <div className="kpi-row" style={{ opacity: errorMsg ? 0.3 : 1, pointerEvents: errorMsg ? 'none' : 'auto' }}>

              {/* Health Score — wide card */}
              <div className="kpi-card kpi-health">
                <div className="kpi-label" style={{ alignSelf: 'flex-start' }}>Score de Santé</div>
                <HealthGauge score={score} triage={data?.triage ?? []} />
              </div>

              {/* Advisories */}
              <div className="kpi-card">
                <div className="kpi-icon" style={{ background: 'var(--critical-dim)' }}>
                  <AlertTriangle size={13} style={{ color: 'var(--critical)' }} />
                </div>
                <div className="kpi-label">Vulnérabilités</div>
                <div
                  className="kpi-value"
                  style={{ color: Number(s.total_vulns) > 0 ? 'var(--critical)' : undefined }}
                >
                  {Number(s.total_vulns ?? 0).toLocaleString()}
                </div>
              </div>

              {/* Direct */}
              <div className="kpi-card">
                <div className="kpi-icon" style={{ background: 'var(--high-dim)' }}>
                  <Zap size={13} style={{ color: 'var(--high)' }} />
                </div>
                <div className="kpi-label">Directes</div>
                <div
                  className="kpi-value"
                  style={{ color: Number(s.direct_vulns) > 0 ? 'var(--high)' : 'var(--fg-muted)' }}
                >
                  {s.direct_vulns ?? 0}
                </div>
              </div>

              {/* Indirect */}
              <div className="kpi-card">
                <div className="kpi-icon" style={{ background: 'var(--surface-3)' }}>
                  <Package size={13} style={{ color: 'var(--fg-muted)' }} />
                </div>
                <div className="kpi-label">Transitives</div>
                <div className="kpi-value" style={{ color: 'var(--fg-muted)' }}>
                  {s.indirect_vulns ?? 0}
                </div>
              </div>

              {/* GHSA DB */}
              <div className="kpi-card">
                <div className="kpi-icon" style={{ background: 'var(--accent-dim)' }}>
                  <Database size={13} style={{ color: 'var(--accent)' }} />
                </div>
                <div className="kpi-label">Base GHSA</div>
                <div className="kpi-value" style={{ fontSize: '1.4rem', color: 'var(--accent)' }}>
                  {Number(s.total_advisories ?? 0).toLocaleString()}
                </div>
              </div>
            </div>

            {/* ── MAIN GRID ────────────────────────────────────── */}
            <div className="main-grid">

              {/* ── Triage ── */}
              <div>
                <div className="section-header">
                  <h2 className="section-title">Priorités de Remédiation</h2>
                  <span className="section-count">{data?.triage?.length ?? 0} packages exposés</span>
                </div>

                {grouped.length > 0 ? (
                  grouped.map(({ sev, items }) => (
                    <div key={sev} className="severity-group">
                      <div className={`severity-group-header sgh-${sev}`}>
                        <div className="group-dot" />
                        <span className="group-label">{SEV_LABELS[sev]}</span>
                        <span className="group-count">{items.length}</span>
                      </div>
                      <div className="issue-list">
                        {items.map((item) => {
                          const idx = cardIndex++;
                          return (
                            <IssueCard
                              key={`${item.name}-${item.advisory_id}`}
                              item={item}
                              index={idx}
                              onCopy={handleCopy}
                              copied={copied}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <CheckCircle size={40} className="empty-icon" />
                    <div className="empty-title">Périmètre Sain</div>
                    <div className="empty-desc">
                      Aucune vulnérabilité connue dans les dépendances.
                    </div>
                  </div>
                )}
              </div>

              {/* ── Sidebar ── */}
              <div className="sidebar">

                {/* Context analysis */}
                <div className="sidebar-card context-card">
                  <div className="context-header">
                    <Zap size={13} style={{ color: 'var(--accent-light)' }} />
                    <span className="context-tag">Analyse contextuelle</span>
                    {data?.isFocused && (
                      <span className="ai-badge">Gemini</span>
                    )}
                  </div>

                  {data?.isFocused && aiLoading ? (
                    <div className="ai-loading">
                      <span className="ai-dot" /><span className="ai-dot" /><span className="ai-dot" />
                      <span className="ai-loading-label">Analyse en cours…</span>
                    </div>
                  ) : data?.isFocused && aiAnalysis ? (
                    <p className="context-text ai-text">{aiAnalysis}</p>
                  ) : (
                    <p className="context-text">{contextMessage(data)}</p>
                  )}

                  <div className="context-footer">
                    <div className="live-dot" />
                    <span className="context-status">
                      {data?.isFocused && aiAnalysis ? 'Analyse IA active' : 'Surveillance active'}
                    </span>
                  </div>
                </div>

                {/* Severity Distribution */}
                {data?.distribution && data.distribution.length > 0 && (
                  <div className="sidebar-card">
                    <div className="dist-title">Distribution des sévérités</div>
                    {SEVERITIES.map(sev => {
                      const d = data.distribution.find(x => x.severity_label === sev);
                      const count = d ? Number(d.count) : 0;
                      const pct = Math.round((count / totalDist) * 100);
                      const labelColor = {
                        critical: 'var(--critical)',
                        high:     'var(--high)',
                        moderate: 'var(--moderate)',
                        low:      'var(--low)',
                      }[sev];

                      return (
                        <div key={sev} className="dist-row">
                          <div className="dist-header">
                            <span className="dist-label" style={{ color: labelColor }}>
                              {SEV_LABELS[sev]}
                            </span>
                            <div className="dist-stats">
                              <span className="dist-count">{count}</span>
                              {count > 0 && <span className="dist-pct">{pct}%</span>}
                            </div>
                          </div>
                          <div className="dist-track">
                            <motion.div
                              className={`dist-fill ${sev}`}
                              initial={{ width: 0 }}
                              animate={{ width: count > 0 ? `${pct}%` : '0%' }}
                              transition={{ duration: 0.9, ease: 'easeOut', delay: 0.1 }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Inventory quick stats */}
                {data?.isFocused && (
                  <div className="sidebar-card mini-stat">
                    <div className="mini-stat-value">{data.inventory?.length ?? 0}</div>
                    <div className="mini-stat-label">dépendances analysées</div>
                    <div
                      className="scan-depth-info"
                      title="Le scan couvre les dépendances directes et leurs dépendances immédiates (niveau 2). Les dépendances transitives profondes ne sont pas analysées."
                    >
                      <Info size={11} />
                      Profondeur : 2 niveaux
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── INVENTORY ─────────────────────────────────────── */}
            {data?.isFocused && data.inventory && data.inventory.length > 0 && (
              <motion.section
                className="inventory-section"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12, duration: 0.28 }}
              >
                <div className="section-header">
                  <div className="inv-header">
                    <Layers size={14} style={{ color: 'var(--accent)' }} />
                    <h2 className="section-title">Inventaire des Dépendances</h2>
                  </div>
                  <div className="inv-controls">
                    <div className="inv-search-wrap">
                      <Search />
                      <input
                        className="inv-search"
                        placeholder="Filtrer par nom…"
                        value={invSearch}
                        onChange={e => setInvSearch(e.target.value)}
                      />
                    </div>
                    <button
                      className={`inv-filter-btn${showVulnOnly ? ' active' : ''}`}
                      onClick={() => setShowVulnOnly(v => !v)}
                    >
                      <Filter size={12} />
                      Vulnérables ({vulnCount})
                    </button>
                    <span className="section-count">{filteredInventory.length} / {data.inventory.length}</span>
                  </div>
                </div>

                <div className="inv-table-wrap">
                  <table className="inv-table">
                    <thead>
                      <tr>
                        <th>Composant</th>
                        <th>Écosystème</th>
                        <th
                          title="Profondeur maximale analysée : 2 niveaux"
                          className="th-depth"
                        >
                          Profondeur <Info size={10} style={{ verticalAlign: 'middle', opacity: 0.5 }} />
                        </th>
                        <th style={{ textAlign: 'right' }}>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInventory.map((dep, i) => (
                        <tr key={i} className={dep.is_vulnerable ? 'row-vuln' : ''}>
                          <td>
                            <div className="inv-comp">
                              <div className="inv-avatar">{dep.name.charAt(0).toUpperCase()}</div>
                              <span className="inv-name">{dep.name}</span>
                            </div>
                          </td>
                          <td><EcoBadge eco={dep.ecosystem} /></td>
                          <td><InvDepthBadge depth={dep.depth} /></td>
                          <td style={{ textAlign: 'right' }}>
                            <div className="vuln-indicator">
                              <div className={`vuln-dot ${dep.is_vulnerable ? 'vuln' : 'safe'}`} />
                              <span style={{ color: dep.is_vulnerable ? 'var(--critical)' : 'var(--safe)' }}>
                                {dep.is_vulnerable ? 'Vulnérable' : 'Sûr'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.section>
            )}

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
