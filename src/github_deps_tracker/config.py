import os
from dotenv import load_dotenv, find_dotenv


def load_config() -> dict:
    """
    Charge les variables d'environnement et retourne la configuration.
    Lève une erreur si la configuration requise (GITHUB_TOKEN) est absente.
    """
    # Cherche le fichier .env dans les dossiers parents
    load_dotenv(find_dotenv())

    token = os.getenv("GITHUB_TOKEN")

    if not token:
        raise ValueError("GITHUB_TOKEN est introuvable dans le fichier .env.")

    return {
        "GITHUB_TOKEN": token
    }
