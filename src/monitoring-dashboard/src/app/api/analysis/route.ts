import { NextResponse } from 'next/server';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
  }

  const { repoName, summary, triage, distribution } = await request.json();

  const sevCounts = ['critical', 'high', 'moderate', 'low'].map(s => {
    const d = distribution?.find((x: any) => x.severity_label === s);
    return d ? `${Number(d.count)} ${s}` : null;
  }).filter(Boolean).join(', ');

  const triageLines = (triage ?? []).slice(0, 15).map((t: any) =>
    `- ${t.name} (${t.ecosystem}) | ${t.severity.toUpperCase()} | CVSS ${t.max_cvss > 0 ? Number(t.max_cvss).toFixed(1) : 'N/A'} | ${Number(t.depth) === 1 ? 'directe' : 'transitive'} | fix: ${t.recommended_fix ?? 'aucun patch disponible'}`
  ).join('\n');

  const prompt = `Tu es un expert en sécurité applicative. Analyse les vulnérabilités du dépôt "${repoName}" et fournis une analyse contextuelle concise en français.

Données du scan :
- Score de santé : ${summary.health_score}/100
- Vulnérabilités : ${summary.total_vulns} total (${summary.direct_vulns} directes, ${summary.indirect_vulns} transitives)
- Distribution : ${sevCounts}

Packages vulnérables par priorité :
${triageLines}

Consignes :
- 3 à 5 phrases maximum
- Identifie le risque principal et la dépendance la plus critique à traiter
- Donne une recommandation concrète et actionnable
- Mentionne si des patches sont disponibles
- Ton professionnel, direct, sans markdown`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.3,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: res.status });
    }

    const data = await res.json();
    const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
    const text = (parts.filter((p: any) => !p.thought).map((p: any) => p.text).join('') || parts[0]?.text || '').trim();
    return NextResponse.json({ analysis: text });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
