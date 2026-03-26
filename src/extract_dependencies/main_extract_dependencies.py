import argparse
import os
import sys

import dlt

from dependency_fetcher import fetch_dependencies_resource


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
os.environ["DLT_PROJECT_DIR"] = PROJECT_ROOT


def main():
    """Point d'entrée principal via DLT Pipeline"""
    parser = argparse.ArgumentParser(description="Pipeline DLT vers MinIO S3.")
    parser.add_argument("owner", help="Le propriétaire du dépôt")
    parser.add_argument("repo", help="Le nom du dépôt")
    parser.add_argument("--depth", type=int, default=2, help="Niveau d'arbre de dépendance")
    args = parser.parse_args()

    # Création du pipeline DLT
    # On précise `destination="filesystem"` qui va piocher sa configuration AWS / S3
    # directement dans le ficher .dlt/secrets.toml
    pipeline = dlt.pipeline(
        pipeline_name="github_deps_tracker",
        destination="filesystem",
        dataset_name="graph_data"
    )

    try:
        # Lancement de l'extraction. "data" pointe vers notre générateur ressource.
        load_info = pipeline.run(
            fetch_dependencies_resource(args.owner, args.repo, args.depth)
        )

        print("\n--- Pipeline DLT terminé avec succès ! ---")
        # Cette fonction affiche les statistiques du transfert vers S3 
        # (temps, tables affectées, ids...)
        print(load_info)
        
    except Exception as e:
        print(f"Erreur lors de l'exécution du pipeline: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
