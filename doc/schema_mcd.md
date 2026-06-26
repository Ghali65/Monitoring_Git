# Schémas MCD — Couches Silver et Gold

## Architecture globale des données

```
GitHub API (GraphQL + REST)
        │
        ▼
   [DLT Pipelines]
        │
        ▼
  Bronze (S3/MinIO)
  JSONL/Parquet bruts
        │
        ▼ S3Queue ClickHouse
  ┌─────────────────────┐
  │   SILVER (ClickHouse) │  ← données brutes structurées
  └─────────────────────┘
        │
        ▼ dbt transformations
  ┌─────────────────────┐
  │   GOLD (ClickHouse)  │  ← star schema analytique
  └─────────────────────┘
```

---

## Couche Silver — MCD (Modèle Conceptuel de Données)

```mermaid
erDiagram
    silver_components {
        UUID    id              PK  "Identifiant unique du composant (uuid5 sur purl)"
        String  purl                "Package URL : pkg:ecosystem/name"
        String  name                "Nom du package ou du dépôt"
        String  ecosystem           "Écosystème : pypi, npm, maven, etc."
        String  github_url          "URL GitHub du dépôt (null si lib tierce)"
        DateTime last_update        "Horodatage de la dernière extraction DLT"
        Boolean is_initial          "true = dépôt client confié, false = dépendance découverte"
        String  _dlt_id         PK  "Clé interne DLT (hash de ligne)"
        String  _dlt_load_id        "Identifiant du lot de chargement DLT"
    }

    silver_dependency_relations {
        String   parent_id          "UUID du composant parent (dépôt ou dépendance intermédiaire)"
        String   child_id           "UUID du composant enfant (la dépendance)"
        String   version            "Contrainte de version (ex: ^1.0.0, >=2.3)"
        Int      depth              "Profondeur dans l'arbre : 1 = dépendance directe"
        DateTime detected_at        "Horodatage de la découverte de cette relation"
        String   _dlt_id        PK  "Clé interne DLT"
        String   _dlt_load_id       "Identifiant du lot de chargement DLT"
    }

    silver_github_advisories {
        String   _dlt_id        PK  "Clé interne DLT (utilisée comme FK par les tables enfants)"
        String   ghsa_id            "Identifiant GHSA (ex: GHSA-xxxx-xxxx-xxxx)"
        String   cve_id             "Identifiant CVE associé (ex: CVE-2023-12345)"
        String   severity           "Sévérité brute GitHub : low / medium / high / critical"
        String   summary            "Description courte de la vulnérabilité"
        Float    cvss__score        "Score CVSS v3 (0.0 à 10.0)"
        DateTime published_at       "Date de publication de l'advisory"
        DateTime updated_at         "Date de dernière mise à jour (curseur incrémental DLT)"
        String   _dlt_load_id       "Identifiant du lot de chargement DLT"
    }

    silver_github_advisories_cwes {
        String  _dlt_id         PK  "Clé interne DLT"
        String  _dlt_parent_id      "FK → silver_github_advisories._dlt_id"
        String  cwe_id              "Identifiant CWE (ex: CWE-79, CWE-89)"
    }

    silver_github_advisories_vulnerabilities {
        String  _dlt_id              PK  "Clé interne DLT"
        String  _dlt_parent_id           "FK → silver_github_advisories._dlt_id"
        String  package__name            "Nom du package vulnérable"
        String  package__ecosystem       "Écosystème : pip, npm, composer, actions, etc."
        String  first_patched_version    "Version corrigeant la faille (null = pas de patch connu)"
    }

    silver_components ||--o{ silver_dependency_relations : "parent_id / child_id → id"
    silver_github_advisories ||--o{ silver_github_advisories_cwes : "_dlt_id → _dlt_parent_id"
    silver_github_advisories ||--o{ silver_github_advisories_vulnerabilities : "_dlt_id → _dlt_parent_id"
```

---

## Couche Gold — MCD Star Schema

```mermaid
erDiagram
    dim_repository {
        UUID    repo_id     PK  "UUID du dépôt (extrait de silver_components.id)"
        String  repo_name       "Nom du dépôt GitHub"
        String  github_url      "URL complète : https://github.com/owner/repo"
        Boolean is_initial      "true = dépôt client confié au monitoring"
    }

    dim_dependency {
        UInt64  unique_id       PK  "Clé surrogate MD5(component_id + version)"
        UUID    dependency_id       "UUID original du composant (silver_components.id)"
        String  name                "Nom du package"
        String  version             "Version requise par le dépôt parent"
        String  ecosystem           "Écosystème : pypi, npm, maven, rubygems, etc."
    }

    dim_advisory {
        String   advisory_id    PK  "Identifiant GHSA (ex: GHSA-xxxx-xxxx-xxxx)"
        String   cve_id             "CVE associé (ex: CVE-2023-12345)"
        Enum8    severity_label     "Sévérité normalisée : low / moderate / high / critical"
        String   summary            "Description de la vulnérabilité"
        Float    cvss__score        "Score CVSS v3 (0.0 à 10.0)"
        Array    cwe_list           "Liste des CWE associés (ex: [CWE-79, CWE-89])"
        String   internal_id        "Référence interne : silver_github_advisories._dlt_id"
        DateTime published_at       "Date de publication"
        DateTime updated_at         "Date de dernière mise à jour"
    }

    dim_date {
        Int     date_id     PK  "Clé date au format YYYYMMDD (ex: 20240115)"
        Date    full_date       "Date complète (ex: 2024-01-15)"
        Int     year            "Année (ex: 2024)"
        Int     month           "Mois 1-12"
        Int     day             "Jour du mois 1-31"
        Int     quarter         "Trimestre 1-4"
        String  day_name        "Nom du jour en anglais (Monday…Sunday)"
        String  month_name      "Nom du mois en anglais (January…December)"
        Int     is_weekend      "1 = samedi ou dimanche, 0 = jour ouvré"
    }

    fact_vulnerability_scan {
        UInt64   scan_id         PK  "Clé surrogate MD5(parent_id + child_id + advisory_id)"
        Int      date_id         FK  "FK → dim_date.date_id (YYYYMMDD)"
        UUID     repo_id         FK  "FK → dim_repository.repo_id"
        UInt64   dependency_key  FK  "FK → dim_dependency.unique_id"
        String   advisory_id     FK  "FK → dim_advisory.advisory_id"
        Enum8    severity_label      "Dénormalisé depuis dim_advisory (optimisation lecture)"
        Float    severity_score      "Score CVSS dénormalisé depuis dim_advisory"
        Int      is_vulnerable       "Toujours 1 — toutes les lignes représentent une alerte"
        Int      has_patch           "1 = un correctif existe, 0 = aucun patch connu"
        DateTime detected_at         "Horodatage précis de détection de la vulnérabilité"
    }

    dim_repository ||--o{ fact_vulnerability_scan : "repo_id"
    dim_dependency ||--o{ fact_vulnerability_scan : "dependency_key"
    dim_advisory   ||--o{ fact_vulnerability_scan : "advisory_id"
    dim_date       ||--o{ fact_vulnerability_scan : "date_id"
```

---

## Flux de transformation Silver → Gold

```
silver_components ──────────────────────────────────┐
silver_dependency_relations ─────────────────────────┼──► dim_repository
                                                     │    (nœuds racine : parent sans parent)
silver_components ──────────────────────────────────┐│
silver_dependency_relations ─────────────────────────┼┴──► dim_dependency
                                                     │     (composant × version unique)
silver_github_advisories ────────────────────────────┐
silver_github_advisories_cwes ───────────────────────┼──► dim_advisory
                                                     │    (normalisation sévérité, agrégation CWE)
[généré] 2024-01-01 + 1500 jours ────────────────────────► dim_date

dim_dependency ──────────────────────────────────────┐
silver_dependency_relations ─────────────────────────┤
silver_github_advisories_vulnerabilities ────────────┼──► fact_vulnerability_scan
dim_advisory ────────────────────────────────────────┘
```
