# Guide de Déploiement : Dagster sur Coolify

Ce guide explique comment brancher ce dépôt GitHub sur ton serveur Coolify, sans jamais commiter de mots de passe sensibles.

---

## 🏗️ Étape 1 : Création du Service dans Coolify

1. Dans Coolify, va dans ton Projet et ajoute une ressource : **"New Resource" > "Public Repository"** (ou "Private" selon ton dépôt Github).
2. Laisse Coolify détecter l'environnement. S'il te le demande, sélectionne **"Docker"** (Nixpacks marche aussi, mais le Dockerfile de notre dépôt est déjà hyper-optimisé).
3. Dans la configuration du service (onglet **"General"**) :
   - Assure-toi que le champ **Ports Exposes** contient bien `3000`. C'est par là que Dagster communique avec l'extérieur.

---

## 🗄️ Étape 2 : Persistance de la mémoire Dagster (Les Volumes)

Si tu oublies cette étape, chaque redémarrage de l'application (ex: un nouveau push sur Github) effacera ton historique de runs Dagster.

1. Va dans l'onglet **"Storages"** (ou **"Volumes"**) de ton application Coolify.
2. Crée un nouveau montage "Bind" ou "Volume" :
   - **Destination :** `/opt/dagster/dagster_home` (C'est le dossier que le Dockerfile a défini).
   - **Source :** Ce que tu veux sur ton serveur hôte (ex: `dagster_data_volume`).
   - Sauvegarde.

---

## 🔒 Étape 3 : Injection des Secrets via l'interface (Variables d'Environnements)

Puisque nous avons rajouté `.dlt/secrets.toml` dans le `.gitignore`, le serveur Coolify ne connaîtra pas tes paires de clés MinIO. DLT dispose d'un système intelligent qui traduit les variables d'environnements brutes en configuration TOML à la volée.

Va dans l'onglet **"Environment Variables"** de Coolify, et crée les secrets suivants (attention aux doubles underscores `__`) :

### 1. Variables de l'API Github
* **`GITHUB_TOKEN`** = `ton_token_personnel_github`

### 2. Variables de Connexion MinIO S3
* **`DESTINATION__FILESYSTEM__CREDENTIALS__AWS_ACCESS_KEY_ID`** = `Ynov`
* **`DESTINATION__FILESYSTEM__CREDENTIALS__AWS_SECRET_ACCESS_KEY`** = `TonMotDePasse`
* **`DESTINATION__FILESYSTEM__CREDENTIALS__ENDPOINT_URL`** = `https://minio-gitmonitor.46.224.33.190.sslip.io`
* **`DESTINATION__FILESYSTEM__BUCKET_URL`** = `s3://bronze/dependencies`

*(Ceci remplace purement et simplement le fichier `.dlt/secrets.toml`)*

---

## ▶️ Étape 4 : Déploiement

Il ne te reste plus qu'à cliquer sur le bouton **"Deploy"** dans Coolify.
Dès que les logs t'indiqueront que l'application est "Healthy", tu pourras cliquer sur le lien généré par ton Coolify pour accéder via HTTPS à l'interface Dagit de l'orchestrateur.
