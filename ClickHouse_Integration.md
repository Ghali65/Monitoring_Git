# Intégration ClickHouse & Data Lake (Option 2)

Ce document est destiné à l'équipe **Data Engineering**. Il explique comment mettre en place l'ingestion asynchrone des données depuis la couche Bronze (le bucket MinIO S3) vers la couche Silver (le moteur analytique ClickHouse).

## Le Mécanisme : S3Queue + MergeTree

Ce schéma repose sur les composants natifs de ClickHouse :
1. Les **Tables Cibles (`MergeTree`)** qui serviront à répondre aux requêtes ultra-rapides.
2. Les **Tables de File d'Attente (`S3Queue`)** qui écoutent le bucket MinIO en continu.
3. Les **Vues Matérialisées (`Materialized Views`)** qui aspirent la donnée de la file d'attente vers les tables cibles dès qu'un nouveau fichier est déposé par le pipeline DLT.

---

## Script d'initialisation SQL

À exécuter directement dans le client ClickHouse. Pensez à remplacer `[HOST-MINIO]`, `[ACCESS_KEY]` et `[SECRET_KEY]` par vos identifiants d'accès au bucket.

### 1️⃣ Table `components` (Les paquets GitHub analysés)

```sql
-- 1. Table Data Warehouse (Silver / Gold) optimisée pour les requêtes analytiques
CREATE TABLE IF NOT EXISTS silver_components (
    id UUID,
    purl String,
    name String,
    ecosystem String,
    github_url Nullable(String),
    last_update DateTime,
    
    -- Le moteur MergeTree est le cœur analytique de ClickHouse
    -- L'ORDER BY sert de Primary Key pour indexer les requêtes
) ENGINE = MergeTree()
ORDER BY id;

-- 2. Configuration d'une sonde (S3Queue) sur le Bucket MinIO
-- JSONEachRow permet à ClickHouse de parser automatiquement les .jsonl ou .jsonl.gz générés par DLT
CREATE TABLE IF NOT EXISTS queue_components (
    id UUID,
    purl String,
    name String,
    ecosystem String,
    github_url Nullable(String),
    last_update DateTime
) ENGINE = S3Queue(
    'https://[HOST-MINIO]/bronze/dependencies/components/*/*.jsonl*', 
    '[ACCESS_KEY]', 
    '[SECRET_KEY]', 
    'JSONEachRow'
)
-- Le mode UNORDERED permet de traiter ingérer nouveaux fichiers en parallèle sans ordre strict
SETTINGS mode = 'UNORDERED';

-- 3. Le tuyau d'ingestion automatisé
-- A chaque fois que DLT pousse un fichier sur S3, ClickHouse va l'aspirer ici.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_ingest_components 
TO silver_components 
AS SELECT * FROM queue_components;
```

### 2️⃣ Table `dependency_relations` (Le Graphe de dépendances)

```sql
-- 1. Table analytique cible
CREATE TABLE IF NOT EXISTS silver_dependency_relations (
    parent_id String,
    child_id String,
    version Nullable(String),
    depth Int32,
    detected_at DateTime
) ENGINE = MergeTree()
ORDER BY (parent_id, child_id);

-- 2. Sonde MinIO
CREATE TABLE IF NOT EXISTS queue_dependency_relations (
    parent_id String,
    child_id String,
    version Nullable(String),
    depth Int32,
    detected_at DateTime
) ENGINE = S3Queue(
    'https://[HOST-MINIO]/bronze/dependencies/dependency_relations/*/*.jsonl*', 
    '[ACCESS_KEY]', 
    '[SECRET_KEY]', 
    'JSONEachRow'
)
SETTINGS mode = 'UNORDERED';

-- 3. Déclencheur
CREATE MATERIALIZED VIEW mv_ingest_dependency_relations
TO silver_dependency_relations
AS SELECT * FROM queue_dependency_relations;
```

> [!TIP]
> **Tolérance aux Pannes**
> Dans ce paradigme, ClickHouse mémorise quels fichiers du bucket S3 ont déjà été traités (grâce à Zoomkeeper/Keeper). Donc même si ClickHouse redémarre, il ne reliera pas tout votre Minio depuis le début, mais reprendra silencieusement l'ingestion des nouveaux fichiers là où il s'était arrêté.
