FROM python:3.12-slim

# Installation de uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
WORKDIR /app

# Point d'ancrage pour la persistance des runs Dagster via Coolify
ENV DAGSTER_HOME=/opt/dagster/dagster_home
RUN mkdir -p $DAGSTER_HOME

# Variables d'environnement pour l'UI web
ENV HOST=0.0.0.0
ENV PORT=3000

# Exposer le port par défaut de Dagster
EXPOSE 3000

# On copie toute l'arborescence (workspace + modules inclus)
COPY . .

# On synchronise spécifiquement tous les packages (dagster/DLT) de l'ensemble du projet sans dev-dependencies
RUN uv sync --frozen --no-dev --all-packages

# Lancement serveur web UI + daemon de l'orchestrateur
CMD ["uv", "run", "dagster", "dev", "-h", "0.0.0.0", "-p", "3000"]
