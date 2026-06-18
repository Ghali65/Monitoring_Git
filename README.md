# Git Monitor — Pipeline de surveillance des dépendances GitHub

Pipeline de données complet pour extraire, transformer et analyser les dépendances et vulnérabilités des dépôts GitHub. Orchestré par **Dagster**, chargé via **DLT**, transformé avec **dbt** sur **ClickHouse**.

---

## Architecture

```
GitHub API (GraphQL + REST)
        |
        v
   DLT (extraction)
        |
        v
   S3 / MinIO  ─────── Bronze (fichiers bruts JSONL / Parquet)
        |
   S3Queue ClickHouse
        |
        v
   ClickHouse  ─────── Silver (tables brutes ingérées)
        |
      dbt build
        |
        v
   ClickHouse  ─────── Gold (modèle en étoile analytique)
```

### Couches de données

| Couche | Technologie | Contenu |
|--------|-------------|---------|
| Bronze | S3 / MinIO | Fichiers bruts DLT (JSONL / Parquet) |
| Silver | ClickHouse (S3Queue) | Tables brutes ingérées depuis MinIO |
| Gold | ClickHouse + dbt | Modèle en étoile prêt pour l'analyse |

### Modèle Gold (dbt)

```
dim_repository    dim_dependency    dim_advisory    dim_date
      |                 |                |              |
      +-----------------+----------------+--------------+
                              |
                   fact_vulnerability_scan
```

---

## Structure du projet

```
.
├── src/
│   ├── definitions.py              # Point d'entrée Dagster (assets, jobs, schedules)
│   ├── github_deps_tracker/        # Package d'extraction des dépendances
│   │   ├── cli/
│   │   │   └── main.py             # Point d'entrée CLI (sans Dagster)
│   │   ├── config.py               # Chargement des variables d'environnement
│   │   ├── dependency_fetcher.py   # Générateur DLT (BFS sur le graphe)
│   │   └── github_client.py        # Client GraphQL GitHub avec retry
│   ├── vulnerability/
│   │   └── request_v.py            # Ressource DLT incrémentale (GitHub Advisories)
│   └── dbt_project/                # Projet dbt (Silver → Gold)
│       ├── models/
│       │   ├── gold/               # Dimensions + table de faits
│       │   └── sources.yml         # Sources Silver déclarées
│       └── profiles.yml            # Profil de connexion ClickHouse
├── workspace.yaml                  # Configuration du workspace Dagster
├── docker-compose.yaml             # Déploiement Dagster + frontend
├── Dockerfile                      # Image Dagster
├── pyproject.toml                  # Dépendances du projet (uv)
└── .env                            # Variables d'environnement (non versionné)
```

---

## Assets Dagster

| Asset | Groupe | Description |
|-------|--------|-------------|
| `github_components` | `github_extraction` | Composants extraits du graphe de dépendances |
| `github_dependency_relations` | `github_extraction` | Relations parent-enfant entre composants |
| `github_advisories` | `vulnerability_extraction` | Advisories de sécurité GitHub |
| `github_advisories_cwes` | `vulnerability_extraction` | CWEs associés aux advisories |
| `github_advisories_vulnerabilities` | `vulnerability_extraction` | Packages affectés par les advisories |
| `github_gold_assets` | *(dbt)* | Modèles Gold générés par `dbt build` |

### Jobs et schedules

| Job | Déclencheur | Description |
|-----|-------------|-------------|
| `vulnerability_sync_job` | Toutes les 2h | Extraction vulnérabilités + dbt |
| `dbt_build_job` | 40 min après extraction | Reconstruction Gold seule |
| `github_dependencies_job` | Backend (à la demande) | Extraction du graphe de dépendances |

---

## Prérequis

- [uv](https://docs.astral.sh/uv/) — gestionnaire de packages Python
- [Docker](https://www.docker.com/) — pour le déploiement
- Un token GitHub avec accès au **Dependency Graph**
- Une instance **MinIO / S3** configurée
- Une instance **ClickHouse** avec S3Queue activé

---

## Installation

```bash
git clone <repo-url>
cd Git_Monitor
uv sync
```

---

## Configuration

### 1. Variables d'environnement

Créer un fichier `.env` à la racine :

```env
# GitHub
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

# ClickHouse
DBT_CH_HOST=localhost
DBT_CH_PORT=8123
DBT_CH_USER=default
DBT_CH_PASSWORD=
DBT_CH_DB=default
DBT_CH_DB_SILVER=silver
DBT_CH_SECURE=false
DBT_CH_VERIFY=false
```

### 2. Secrets DLT (connexion S3 / MinIO)

Créer `src/github_deps_tracker/.dlt/secrets.toml` :

```toml
[destination.filesystem]
bucket_url = "s3://bronze"

[destination.filesystem.credentials]
aws_access_key_id     = "minioadmin"
aws_secret_access_key = "minioadmin"
endpoint_url          = "http://localhost:9000"

[sources.github]
token = "ghp_xxxxxxxxxxxxxxxxxxxx"
```

---

## Utilisation

### Lancer Dagster (développement)

```bash
uv run dagster dev
```

Interface disponible sur [http://localhost:3000](http://localhost:3000).

### Extraction via la CLI (sans Dagster)

```bash
uv run python src/github_deps_tracker/cli/main.py <owner> <repo> --depth 2
```

Exemple :

```bash
uv run python src/github_deps_tracker/cli/main.py facebook react --depth 2
```

---

## Déploiement Docker

```bash
docker compose up --build
```

| Service | Port | Description |
|---------|------|-------------|
| `dagster` | 3000 | Webserver + daemon Dagster |
| `frontend` | 3001 | Dashboard de monitoring |

---

## Développement

```bash
# Linter et formatage
uv run ruff check --fix .

# Tests
uv run pytest tests/
```
