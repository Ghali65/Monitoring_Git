# Landing Page React

Petit front-end React/Vite pour saisir une URL de dépôt GitHub et déclencher une analyse.

## Installation

```bash
cd src/landing_page
npm install
```

## Exécution locale

```bash
npm run dev
```

## Usage

- Saisissez une URL GitHub au format `https://github.com/owner/repo` ou `owner/repo`.
- Le formulaire envoie une requête POST vers `/api/trigger-analysis`.
- Le backend Python expose ce point de terminaison pour lancer l’analyse.

## Backend

Le backend est disponible dans `src/landing_page/backend.py`.

Ce backend lance le job Dagster `github_dependencies_job` défini dans `src/definitions.py`, ce qui permet de démarrer l’analyse via Dagster.

### Exécution du backend

```bash
cd /Users/romai/Desktop/Exo_WCS/Monitoring_Git
python3 -m pip install fastapi uvicorn
uvicorn src.landing_page.backend:app --reload --host 0.0.0.0 --port 8000
```

**Note :** Le backend configure automatiquement `DAGSTER_HOME` vers `src/.dagster_home` pour la persistance des runs.

### Développement local complet

1. Démarrer le backend :

```bash
python3 -m uvicorn src.landing_page.backend:app --reload --host 0.0.0.0 --port 8000
```

2. Dans un autre terminal, lancer l’interface React :

```bash
cd src/landing_page
npm install
npm run dev
```

Le front-end appellera ensuite automatiquement `http://localhost:8000/api/trigger-analysis` via le proxy Vite.
