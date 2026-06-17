import { useState } from "react";

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

function App() {
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

      setResult({ status: "success", message: `Analyse lancée avec succès pour ${parsed.owner}/${parsed.repo}.` });
    } catch (error) {
      setResult({ status: "error", message: `Échec : ${error instanceof Error ? error.message : "erreur inconnue"}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="hero-wrapper">
      <div className="top-logo">
        <img src="/logo.png" alt="Logo" style={{ width: '40px', height: '40px', objectFit: 'contain' }} />
        <div className="brand-name">
          Git<span>Monitoring</span>
        </div>
      </div>

      <main className="main-container">

        <section className="hero-content">
          <h1>
            Analysez vos Dépôts <br />
            <span className="accent-text">en Temps Réel</span>
          </h1>
          <p className="hero-description">
            Visualisez vos dépendances, détectez les vulnérabilités et optimisez votre graphe de composants.
          </p>

          <div className="card">
            <form onSubmit={handleSubmit} className="form-block">
              <div className="input-wrapper">
                <input
                  id="repoUrl"
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

export default App;
