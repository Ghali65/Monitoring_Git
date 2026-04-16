# Ynov Data Science - GitHub Dependencies Tracker

## 🎯 Objectif du projet
Ce projet est un pipeline d'ingénierie de données conçu pour extraire automatiquement l'arborescence complète des dépendances de n'importe quel dépôt GitHub. 

Une fois les données récupérées, elles sont structurées de manière relationnelle et automatiquement transférées vers une zone de stockage distribué (bucket S3 / MinIO) pour être consommables par des processus d'analyse ou de Data Science.

---

## ⚙️ Comment ça fonctionne ? (Sous le capot)

Le pipeline est construit de manière modulaire (suivant les principes SOLID) et s'articule via la librairie **DLT (Data Load Tool)**. Voici le cycle de vie d'une extraction :

1. **Extraction (Client GraphQL - `github_client.py`)**  
   Le script se connecte à l'API GitHub GraphQL pour lister les dépendances et manifestes (fichiers `package.json`, `pyproject.toml`, etc.). Pour surmonter les limites de l'API GitHub sur les très gros répertoires, un système de **pagination** et de **"retry" (Tolérance aux pannes)** est implémenté nativement lors des requêtes.

2. **Transformation et Structuration (`dependency_fetcher.py`)**  
   Les données brutes (JSON) sont aplaties par le "ressource generator" de DLT. À ce stade, le graphe de dépendance est scindé en deux tables distinctes pour assurer une cohérence relationnelle (ou forme de Graphe) :
   - `components` : contient l'information sur le paquet lui-même, identifié formellement par un standard _PURL (Package URL)_ et classifié par son environnement (pypi, npm, maven...).
   - `dependency_relations` : contient la liaison parent-enfant entre deux paquets ainsi que sa profondeur dans l'arbre d'exploration.

3. **Chargement Automatisé (`main.py` et `.dlt/secrets.toml`)**  
   Le point d'entrée lance le pipeline DLT configuré pour la destination `filesystem`. DLT gère les évolutions de schéma automatiquement et va se connecter au MinIO (grâce aux clés préconfigurées dans `secrets.toml`) pour transférer la data sous le nom de dataset `graph_data`.

---

## 🚀 Comment lancer le pipeline ?

### Pré-requis
1. L'outil de dépendances **UV** installé.
2. Un fichier **`.env`** placé à la racine du projet contenant ton token Github :
   ```env
   GITHUB_TOKEN=ghp_ton1token2secret3...
   ```
3. Tes identifiants S3 / MinIO correctement remplis dans le fichier `github_deps_tracker/.dlt/secrets.toml`.

### Lancer une extraction
Se positionner à la racine et exécuter l'outil via `uv run` avec le propriétaire GitHub, le nom du repo et la profondeur d'arbre souhaitée :

```bash
uv run github_deps_tracker/main.py <PROPRIÉTAIRE> <REPO> --depth <PROFONDEUR>
```
**Exemple** :
```bash
uv run github_deps_tracker/main.py facebook react --depth 2
```

## 🗂️ Architecture des dossiers
```
.
├── .env                        # Variables d'environnement pour API GITHUB
├── pyproject.toml              # Espace de travail UV (workspace config)
├── README.md                   # Ce fichier
└── github_deps_tracker
    ├── .dlt
    │   └── secrets.toml        # Configurations secretes pour connexion destination S3
    ├── main.py                 # Point d'entrée du pipeline DLT
    ├── config.py               # Chargement automatique des configs
    ├── dependency_fetcher.py   # Transformeur de graphe en tables
    └── github_client.py        # Moteur GraphQL et requêtes HTTP
```
