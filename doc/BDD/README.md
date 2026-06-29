# Documentation des bases de données — Monitoring Git

Ce projet est un **tracker d'alertes de vulnérabilités** pour des dépôts GitHub clients.
L'idée : des clients confient leurs dépôts Git, et le système monitore automatiquement les dépendances pour détecter les vulnérabilités de sécurité connues.

Les données sont organisées en trois couches : **Bronze → Silver → Gold**.

---

## Sommaire

1. [Architecture générale](#1-architecture-générale)
2. [Couche Silver](#2-couche-silver)
   - [silver_components](#21-silver_components)
   - [silver_dependency_relations](#22-silver_dependency_relations)
   - [silver_github_advisories](#23-silver_github_advisories)
   - [silver_github_advisories_cwes](#24-silver_github_advisories_cwes)
   - [silver_github_advisories_vulnerabilities](#25-silver_github_advisories_vulnerabilities)
3. [Couche Gold](#3-couche-gold)
   - [dim_repository](#31-dim_repository)
   - [dim_dependency](#32-dim_dependency)
   - [dim_advisory](#33-dim_advisory)
   - [dim_date](#34-dim_date)
   - [fact_vulnerability_scan](#35-fact_vulnerability_scan)
4. [Mapping des écosystèmes](#4-mapping-des-écosystèmes)
5. [Questions analytiques typiques](#5-questions-analytiques-typiques)

---

## 1. Architecture générale

```
GitHub GraphQL API          GitHub REST API
(dépendances des dépôts)    (advisories de sécurité)
         │                          │
         ▼                          ▼
   DLT Pipeline              DLT Pipeline
 (dependency_fetcher)       (fetch_advisories)
         │                          │
         ▼                          ▼
    Bronze (S3/MinIO)          Bronze (S3/MinIO)
    JSONL — composants         JSONL — advisories
         │                          │
         └──────────┬───────────────┘
                    ▼
          S3Queue → ClickHouse
        ┌────────────────────────┐
        │       SILVER           │
        │  données brutes        │
        │  ingérées telles       │
        │  quelles depuis l'API  │
        └────────────┬───────────┘
                     │ dbt (transformations SQL)
                     ▼
        ┌────────────────────────┐
        │        GOLD            │
        │  star schema           │
        │  prêt pour l'analyse   │
        └────────────────────────┘
```

**Pourquoi trois couches ?**

| Couche | Rôle | Format |
|--------|------|--------|
| Bronze | Archive brute, rejoue les pipelines | JSONL/Parquet sur S3 |
| Silver | Données structurées, proches de l'API | Tables ClickHouse |
| Gold   | Modèle analytique optimisé pour les dashboards | Star schema ClickHouse |

---

## 2. Couche Silver

Les tables Silver reçoivent les données telles qu'elles arrivent des pipelines DLT.
Elles conservent les champs internes DLT (`_dlt_id`, `_dlt_load_id`) qui servent de clés de jointure entre tables enfants et tables parentes.

### 2.1 `silver_components`

**Rôle** : Catalogue de tous les composants connus — que ce soit un dépôt client ou une bibliothèque tierce détectée comme dépendance.

Un composant est identifié par son **PURL** (Package URL), un standard universel pour référencer un package quel que soit son écosystème.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | UUID | Identifiant unique calculé via `uuid5(NAMESPACE_URL, purl)`. Stable : le même package aura toujours le même UUID. |
| `purl` | String | Package URL au format `pkg:ecosystem/name` (ex: `pkg:pypi/requests`, `pkg:github/octocat/hello-world`). Standard universel d'identification. |
| `name` | String | Nom lisible du package ou du dépôt (ex: `requests`, `django`, `hello-world`). |
| `ecosystem` | String | Registre d'appartenance. Valeurs : `github`, `pypi`, `npm`, `maven`, `rubygems`, `packagist`, `golang`, `githubactions`, `unknown`. |
| `github_url` | String | URL GitHub du dépôt source (ex: `https://github.com/psf/requests`). `NULL` si la bibliothèque n'a pas de dépôt GitHub connu. |
| `last_update` | DateTime | Horodatage UTC de la dernière fois que ce composant a été vu lors d'une extraction DLT. |
| `is_initial` | Boolean | `true` uniquement pour les **dépôts clients** confiés au monitoring (profondeur 1 dans le BFS). `false` pour toutes les dépendances découvertes automatiquement. |
| `_dlt_id` | String | Clé interne DLT : hash unique de la ligne. Sert de clé primaire logique dans DLT. |
| `_dlt_load_id` | String | Identifiant du lot de chargement DLT. Permet de tracer à quelle exécution appartient une ligne. |

**Comment est peuplée cette table ?**

Le pipeline DLT fait un parcours BFS (Breadth-First Search) depuis chaque dépôt client. À chaque nœud visité, il insère une ligne dans `components`. Un même package peut apparaître plusieurs fois (il est dédupliqué en Gold via GROUP BY).

---

### 2.2 `silver_dependency_relations`

**Rôle** : Enregistre les **liens de dépendance** entre composants — "le dépôt A dépend de la bibliothèque B en version X".

C'est une table d'adjacence qui représente le graphe orienté des dépendances.

| Colonne | Type | Description |
|---------|------|-------------|
| `parent_id` | String (UUID) | UUID du composant parent (celui qui déclare la dépendance). Pour les dépôts clients, c'est leur propre UUID. |
| `child_id` | String (UUID) | UUID du composant enfant (la bibliothèque requise). Référence `silver_components.id`. |
| `version` | String | Contrainte de version telle qu'elle apparaît dans le fichier manifest (ex: `^1.0.0`, `>=2.3,<3`, `1.2.3`). `NULL` si non spécifiée. |
| `depth` | Int | Profondeur dans l'arbre de dépendances. `1` = dépendance directe du dépôt client, `2` = dépendance d'une dépendance, etc. |
| `detected_at` | DateTime | Horodatage UTC de la détection de cette relation. Représente "quand avons-nous vu ce lien pour la dernière fois". |
| `_dlt_id` | String | Clé interne DLT. |
| `_dlt_load_id` | String | Identifiant du lot de chargement DLT. |

**Comment identifier un dépôt client ?**

Un dépôt client est un nœud qui apparaît comme `parent_id` mais **jamais** comme `child_id`. C'est exactement la logique utilisée par `dim_repository` en Gold.

**Exemple de graphe** :

```
mon-projet (depth=1 parent)
├── requests 2.28.0 (depth=1 child)
│   └── urllib3 1.26.0 (depth=2 child)
└── django 4.2.0 (depth=1 child)
```

---

### 2.3 `silver_github_advisories`

**Rôle** : Stocke les **avis de sécurité GitHub** (GitHub Security Advisories). Ce sont les bulletins officiels annonçant des vulnérabilités dans des packages open source.

Ces données viennent de l'API REST GitHub : `https://api.github.com/advisories`.
L'extraction est **incrémentale** : seules les advisories modifiées depuis le dernier run sont récupérées (curseur sur `updated_at`).

| Colonne | Type | Description |
|---------|------|-------------|
| `_dlt_id` | String | Clé interne DLT. **Utilisée comme FK** par `silver_github_advisories_cwes` et `silver_github_advisories_vulnerabilities` via leur colonne `_dlt_parent_id`. |
| `ghsa_id` | String | Identifiant GitHub Security Advisory (ex: `GHSA-cfjv-ggwp-mcr5`). Format stable, référençable publiquement. |
| `cve_id` | String | Identifiant CVE associé (ex: `CVE-2023-32675`). Peut être `NULL` si l'advisory n'a pas encore de CVE assigné. |
| `severity` | String | Niveau de sévérité **brut** tel que fourni par GitHub : `low`, `medium`, `high`, `critical`. Note : GitHub utilise `medium` là où le standard CVSS dit `moderate`. |
| `summary` | String | Phrase courte décrivant la vulnérabilité (ex: "SQL injection in login form"). |
| `cvss__score` | Float | Score CVSS v3.x (0.0 à 10.0). Plus le score est élevé, plus la vulnérabilité est grave. `NULL` si le score n'est pas encore calculé. |
| `published_at` | DateTime | Date à laquelle l'advisory a été publié publiquement par GitHub. |
| `updated_at` | DateTime | Date de la dernière modification de l'advisory. C'est le **curseur incrémental** DLT : la prochaine exécution ne récupère que les advisories avec `updated_at > last_value`. |
| `_dlt_load_id` | String | Identifiant du lot de chargement DLT. |

---

### 2.4 `silver_github_advisories_cwes`

**Rôle** : Table de **décomposition** des identifiants CWE (Common Weakness Enumeration) liés à chaque advisory.

Une advisory peut référencer plusieurs CWE (ex: une faille qui est à la fois une injection SQL et une mauvaise gestion de l'authentification). GitHub les renvoie sous forme de liste, DLT les explose en lignes séparées.

| Colonne | Type | Description |
|---------|------|-------------|
| `_dlt_id` | String | Clé interne DLT de cette ligne. |
| `_dlt_parent_id` | String | **FK → `silver_github_advisories._dlt_id`**. Permet de retrouver l'advisory parente. |
| `cwe_id` | String | Identifiant CWE (ex: `CWE-89` pour SQL Injection, `CWE-79` pour XSS). |

**Usage** : En Gold, tous les CWE d'une même advisory sont regroupés en un tableau (`cwe_list`) via `groupArray()`.

---

### 2.5 `silver_github_advisories_vulnerabilities`

**Rôle** : Liste les **packages spécifiquement affectés** par chaque advisory, avec la version qui corrige la faille.

C'est la table pivot entre "une vulnérabilité connue" et "les packages qui en souffrent".

| Colonne | Type | Description |
|---------|------|-------------|
| `_dlt_id` | String | Clé interne DLT de cette ligne. |
| `_dlt_parent_id` | String | **FK → `silver_github_advisories._dlt_id`**. L'advisory qui décrit cette vulnérabilité. |
| `package__name` | String | Nom du package vulnérable (ex: `requests`, `lodash`, `log4j`). |
| `package__ecosystem` | String | Écosystème du package vulnérable tel que GitHub le nomme : `pip`, `npm`, `maven`, `composer`, `rubygems`, `go`, `actions`, etc. **Attention** : les noms diffèrent de ceux utilisés par DLT (voir [mapping](#4-mapping-des-écosystèmes)). |
| `first_patched_version` | String | Version minimale qui corrige la vulnérabilité (ex: `2.28.2`). `NULL` si aucun patch n'est encore disponible — c'est une **zero-day**. |

---

## 3. Couche Gold

La couche Gold est un **star schema** optimisé pour les requêtes analytiques.
Elle est construite par dbt à partir des tables Silver.

Le centre du schéma est `fact_vulnerability_scan` : chaque ligne représente **une dépendance vulnérable dans un dépôt client, à une date donnée**.

Voir aussi : [schema_mcd.md](./schema_mcd.md) pour les diagrammes visuels.

---

### 3.1 `dim_repository`

**Rôle** : Référentiel des **dépôts GitHub suivis**. Seuls les vrais dépôts racines (nœuds clients) y figurent, pas les bibliothèques intermédiaires.

**Logique de construction** : un vrai dépôt est un composant qui apparaît comme `parent_id` dans `silver_dependency_relations` mais **jamais** comme `child_id`. C'est la définition d'un nœud racine dans le graphe.

| Colonne | Type | Description |
|---------|------|-------------|
| `repo_id` | UUID | Identifiant unique du dépôt. Correspond à `silver_components.id` du dépôt racine. |
| `repo_name` | String | Nom du dépôt (ex: `my-api`, `frontend-app`). |
| `github_url` | String | URL GitHub complète (ex: `https://github.com/acme/my-api`). |
| `is_initial` | Boolean | `true` si le dépôt a été explicitement confié par un client. `false` si c'est un dépôt découvert comme dépendance d'un autre dépôt client. |

---

### 3.2 `dim_dependency`

**Rôle** : Référentiel des **dépendances** (bibliothèques tierces). Chaque combinaison `package + version` est une entrée distincte.

**Pourquoi package + version ?** Un même package peut avoir une version vulnérable et une version saine. La clé doit capturer les deux.

| Colonne | Type | Description |
|---------|------|-------------|
| `unique_id` | UInt64 | **Clé surrogate** générée par `MD5(component_id + version)`. Stable et compact pour les jointures dans la table de faits. |
| `dependency_id` | UUID | UUID original du composant depuis `silver_components.id`. |
| `name` | String | Nom du package (ex: `requests`, `express`, `spring-core`). |
| `version` | String | Version requise dans le manifest parent (ex: `2.28.0`, `^4.18.0`). `NULL` si non contrainte. |
| `ecosystem` | String | Écosystème DLT (ex: `pypi`, `npm`, `maven`). **Différent de l'écosystème GitHub Advisory** — voir [mapping](#4-mapping-des-écosystèmes). |

---

### 3.3 `dim_advisory`

**Rôle** : Référentiel des **vulnérabilités de sécurité connues**. Chaque ligne est un bulletin de sécurité officiel GitHub.

**Normalisation de la sévérité** : GitHub utilise `medium` mais le standard CVSS dit `moderate`. dbt corrige cela ici.

| Colonne | Type | Description |
|---------|------|-------------|
| `advisory_id` | String | Identifiant GHSA (ex: `GHSA-cfjv-ggwp-mcr5`). Clé publique stable, référençable sur `https://github.com/advisories/`. |
| `cve_id` | String | Identifiant CVE si disponible (ex: `CVE-2023-32675`). `NULL` si pas encore assigné. |
| `severity_label` | Enum8 | Sévérité **normalisée** : `low` (1) / `moderate` (2) / `high` (3) / `critical` (4). `medium` de GitHub est converti en `moderate`. Ordre numérique permet le tri. |
| `summary` | String | Description courte de la vulnérabilité. |
| `cvss__score` | Float | Score CVSS v3 de 0.0 à 10.0. Barème indicatif : 0-3.9 = low, 4-6.9 = medium, 7-8.9 = high, 9-10 = critical. |
| `cwe_list` | Array(String) | Liste agrégée des CWE associés (ex: `['CWE-89', 'CWE-564']`). Regroupés depuis `silver_github_advisories_cwes`. |
| `internal_id` | String | Référence interne vers `silver_github_advisories._dlt_id`. Utilisée comme clé de jointure avec `silver_github_advisories_vulnerabilities`. |
| `published_at` | DateTime | Date de publication officielle de l'advisory. |
| `updated_at` | DateTime | Date de dernière mise à jour de l'advisory. |

---

### 3.4 `dim_date`

**Rôle** : Dimension temporelle pré-générée. Permet les analyses par période (par mois, trimestre, jour ouvré vs week-end) sans recalculer à chaque requête.

Couvre **1500 jours** à partir du 2024-01-01 (~4 ans).

| Colonne | Type | Description |
|---------|------|-------------|
| `date_id` | Int | **Clé primaire** au format `YYYYMMDD` (ex: `20240115`). C'est ce format qui est stocké dans `fact_vulnerability_scan.date_id`. |
| `full_date` | Date | Date complète (ex: `2024-01-15`). |
| `year` | Int | Année (ex: `2024`). |
| `month` | Int | Mois 1–12. |
| `day` | Int | Jour du mois 1–31. |
| `quarter` | Int | Trimestre 1–4. |
| `day_name` | String | Nom du jour en anglais (ex: `Monday`, `Tuesday`…). |
| `month_name` | String | Nom du mois en anglais (ex: `January`, `February`…). |
| `is_weekend` | Int | `1` = samedi ou dimanche, `0` = jour ouvré. Utile pour filtrer les alertes en dehors des heures de travail. |

---

### 3.5 `fact_vulnerability_scan`

**Rôle** : **Table centrale du star schema.** Chaque ligne représente une alerte active : "la dépendance D du dépôt R est affectée par la vulnérabilité V, détectée le J".

C'est la table que les dashboards et requêtes analytiques interrogent en priorité.

| Colonne | Type | FK vers | Description |
|---------|------|---------|-------------|
| `scan_id` | UInt64 | — | **Clé surrogate** : `MD5(parent_id + child_id + advisory_id)`. Identifie de façon unique une combinaison dépôt × dépendance × advisory. |
| `date_id` | Int | `dim_date.date_id` | Date de détection au format YYYYMMDD. Permet les jointures avec `dim_date` pour les analyses temporelles. |
| `repo_id` | UUID | `dim_repository.repo_id` | Le dépôt client concerné par la vulnérabilité. |
| `dependency_key` | UInt64 | `dim_dependency.unique_id` | La dépendance spécifique vulnérable (package + version). |
| `advisory_id` | String | `dim_advisory.advisory_id` | L'advisory de sécurité qui documente la faille. |
| `severity_label` | Enum8 | — | **Dénormalisé** depuis `dim_advisory` pour éviter une jointure sur les requêtes de filtrage fréquentes. Valeurs : `low` / `moderate` / `high` / `critical`. |
| `severity_score` | Float | — | Score CVSS **dénormalisé** depuis `dim_advisory`. Même raison : performance des requêtes de tri et filtrage. |
| `is_vulnerable` | Int | — | Toujours `1`. Toutes les lignes de cette table représentent une vulnérabilité active. Conservé pour des raisons de compatibilité analytique (COUNT, SUM). |
| `has_patch` | Int | — | `1` si `first_patched_version` est renseigné dans Silver (un correctif existe), `0` si aucun patch n'est connu (zero-day potentielle). |
| `detected_at` | DateTime | — | Horodatage précis (avec heure) de la détection. Correspond à `silver_dependency_relations.detected_at` — le moment où le pipeline a vu cette relation de dépendance. |

**Comment une ligne est-elle générée ?**

```
Pour chaque relation (dépôt → dépendance) dans Silver :
  → Cherche dans Silver si un advisory vulnérable correspond au nom + écosystème de la dépendance
  → Si oui → crée une ligne dans fact_vulnerability_scan
```

La jointure sur l'écosystème utilise un mapping (voir section suivante) car les noms d'écosystèmes diffèrent entre DLT et l'API GitHub Advisories.

---

## 4. Mapping des écosystèmes

Les noms d'écosystèmes **ne sont pas identiques** entre la pipeline DLT (qui lit les manifests GitHub) et l'API GitHub Advisories. dbt gère cette correspondance dans `fact_vulnerability_scan` :

| Écosystème DLT (`dim_dependency.ecosystem`) | Écosystème Advisory GitHub (`package__ecosystem`) |
|---------------------------------------------|--------------------------------------------------|
| `pypi` | `pip` |
| `packagist` | `composer` |
| `githubactions` | `actions` |
| `npm` | `npm` (identique) |
| `maven` | `maven` (identique) |
| `rubygems` | `rubygems` (identique) |
| `golang` | `go` |

---

## 5. Questions analytiques typiques

Ces exemples illustrent comment exploiter le star schema Gold.

**Combien de vulnérabilités critiques par dépôt ce mois-ci ?**
```sql
SELECT r.repo_name, COUNT(*) as nb_critical
FROM fact_vulnerability_scan f
JOIN dim_repository r ON f.repo_id = r.repo_id
JOIN dim_date d ON f.date_id = d.date_id
WHERE f.severity_label = 'critical'
  AND d.year = 2024 AND d.month = 6
GROUP BY r.repo_name
ORDER BY nb_critical DESC
```

**Quelles dépendances sans patch disponible pour un dépôt donné ?**
```sql
SELECT dep.name, dep.version, dep.ecosystem, adv.advisory_id, adv.summary
FROM fact_vulnerability_scan f
JOIN dim_repository r ON f.repo_id = r.repo_id
JOIN dim_dependency dep ON f.dependency_key = dep.unique_id
JOIN dim_advisory adv ON f.advisory_id = adv.advisory_id
WHERE r.repo_name = 'mon-projet'
  AND f.has_patch = 0
ORDER BY f.severity_score DESC
```

**Évolution du nombre d'alertes par semaine sur les 3 derniers mois ?**
```sql
SELECT d.year, d.month, toWeek(d.full_date) as week, COUNT(*) as alerts
FROM fact_vulnerability_scan f
JOIN dim_date d ON f.date_id = d.date_id
WHERE d.full_date >= today() - 90
GROUP BY d.year, d.month, week
ORDER BY d.year, week
```

**Top 10 des CWE les plus fréquents dans nos dépôts clients ?**
```sql
SELECT cwe, COUNT(*) as occurrences
FROM fact_vulnerability_scan f
JOIN dim_advisory adv ON f.advisory_id = adv.advisory_id
ARRAY JOIN adv.cwe_list as cwe
GROUP BY cwe
ORDER BY occurrences DESC
LIMIT 10
```
