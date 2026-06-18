"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { DependencyGraph } from "./components/DependencyGraph";

const parseGithubRepoUrl = (url: string) => {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\s+/g, "");
  const patterns = [
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/(?<owner>[^\/\s]+)\/(?<repo>[^\/\s]+)(?:\.git)?(?:\/.*)?$/i,
    /^(?<owner>[^\/\s]+)\/(?<repo>[^\/\s]+)$/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match?.groups?.owner && match.groups.repo) {
      return {
        owner: match.groups.owner,
        repo: match.groups.repo.replace(/\.git$/i, ""),
      };
    }
  }

  return null;
};

type TriggerResult = {
  status: "idle" | "pending" | "success" | "error";
  message: string;
};

const initialResult: TriggerResult = {
  status: "idle",
  message: "Entrez l’URL d’un dépôt GitHub pour lancer l’analyse.",
};

export default function LandingPage() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState("https://github.com/facebook/react");
  const [result, setResult] = useState<TriggerResult>(initialResult);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseGithubRepoUrl(repoUrl);

    if (!parsed) {
      setResult({ status: "error", message: "URL invalide. Exemple : https://github.com/facebook/react" });
      return;
    }

    setIsSubmitting(true);
    setResult({ status: "pending", message: `Analyse en cours pour ${parsed.owner}/${parsed.repo}...` });

    try {
      const response = await fetch("/api/trigger-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: parsed.owner, repo: parsed.repo }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || response.statusText);
      }

      setResult({ status: "success", message: `Analyse lancée avec succès pour ${parsed.owner}/${parsed.repo}. Redirection...` });
      
      // Redirect to dashboard after 1.5 seconds so user can see success message
      setTimeout(() => {
        router.push("/dashboard");
      }, 1500);

    } catch (error) {
      setResult({ status: "error", message: `Échec : ${error instanceof Error ? error.message : "erreur inconnue"}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="hero-wrapper">
      <DependencyGraph light />

      <div className="top-logo">
        <Image src="/logo.png" alt="Logo" width={36} height={36} style={{ objectFit: 'contain' }} />
        <div className="brand-name">
          Git<span>Monitoring</span>
        </div>
      </div>

      {/* Menu Top Right */}
      <div style={{ position: 'absolute', top: '32px', right: '5%', zIndex: 20 }}>
        <Link href="/dashboard" style={{
          textDecoration: 'none',
          color: 'var(--text-main)',
          fontWeight: 600,
          fontSize: '0.88rem',
          padding: '9px 18px',
          background: 'rgba(249,115,22,0.06)',
          borderRadius: '12px',
          border: '1px solid rgba(249,115,22,0.2)',
          transition: 'all 0.25s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(249,115,22,0.1)';
          e.currentTarget.style.borderColor = 'rgba(249,115,22,0.4)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(249,115,22,0.06)';
          e.currentTarget.style.borderColor = 'rgba(249,115,22,0.2)';
        }}
        >
          Accéder au Dashboard
        </Link>
      </div>

      <main className="main-container">
        <section className="hero-content">
          <div className="hero-eyebrow">
            <div className="eyebrow-dot" />
            <span>Scanner de vulnérabilités</span>
          </div>

          <h1>
            Vos dépendances, <br />
            <span className="accent-text">sous le scanner.</span>
          </h1>
          <p className="hero-description">
            Branchez un dépôt GitHub public et obtenez l'état exact de vos vulnérabilités, packages exposés, CVE actives, niveaux de sévérité, correctifs disponibles.
          </p>

          <div className="card">
            <form onSubmit={handleSubmit} className="form-block">
              <div className="input-wrapper">
                <input
                  id="repoUrl"
                  className="url-input"
                  type="text"
                  value={repoUrl}
                  onChange={(event) => setRepoUrl(event.target.value)}
                  placeholder="https://github.com/facebook/react"
                  disabled={isSubmitting}
                />
              </div>

              <div className="cta-group">
                <button type="submit" className="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Analyse en cours..." : "Lancer l'Analyse"}
                </button>
                <button type="button" className="secondary" onClick={() => setRepoUrl("")}>
                  Effacer
                </button>
              </div>
            </form>

            {result.status !== 'idle' && (
              <div className={`status-message ${result.status}`}>
                {result.message}
              </div>
            )}

            <section className="tips-section">
              <h2>Exemples rapides</h2>
              <ul className="examples-list">
                {["facebook/react", "pallets/flask", "django/django"].map(ex => (
                  <li key={ex} className="example-tag" onClick={() => setRepoUrl(`https://github.com/${ex}`)}>
                    {ex}
                  </li>
                ))}
              </ul>

              <details open={showHelp} onToggle={(e) => setShowHelp((e.target as HTMLDetailsElement).open)}>
                <summary>Comment préparer mon dépôt ?</summary>
                <div className="help-content">
                  <p>Assurez-vous que le <strong>Dependency Graph</strong> est activé dans <em>Settings &gt; Code security and analysis</em> de votre dépôt GitHub public.</p>
                </div>
              </details>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
