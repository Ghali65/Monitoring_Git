import os
from dagster import Config, asset, MaterializeResult, Definitions, AssetExecutionContext
from dagster_dbt import DbtCliResource, dbt_assets, DagsterDbtProject
import dlt
from pathlib import Path

# On charge PROJECT_ROOT et on le met explicitement pour que dlt trouve .dlt à l'intérieur
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.environ["DLT_PROJECT_DIR"] = os.path.join(PROJECT_ROOT, "github_deps_tracker")

from dependency_fetcher import fetch_dependencies_resource

DBT_PROJECT_DIR = Path(__file__).joinpath("..", "..", "dbt_project").resolve()
dbt_project = DagsterDbtProject(project_dir=DBT_PROJECT_DIR)

class GithubDepsConfig(Config):
    """
    Paramètres saisis via l'interface du Launchpad de Dagster.
    Par défaut, on lance sur facebook/react.
    """
    owner: str = "facebook"
    repo: str = "react"
    depth: int = 2

@asset(
    compute_kind="python",
    group_name="github_extraction",
    description="Extraction complète des dépendances Github via DLT pour l'export S3/MinIO."
)
def extract_github_dependencies(context, config: GithubDepsConfig):
    """
    Exécute le pipeline DLT depuis Dagster.
    """
    context.log.info(f"Démarrage de l'extraction DLT pour le repo : {config.owner}/{config.repo}")
    
    # Création du pipeline DLT (identique au main.py de secours)
    pipeline = dlt.pipeline(
        pipeline_name="github_deps_tracker",
        destination="filesystem",
        dataset_name="graph_data"
    )

    # Lancement de l'extraction avec nos paramètres Dagster
    load_info = pipeline.run(
        fetch_dependencies_resource(config.owner, config.repo, config.depth)
    )

    context.log.info(f"Extraction terminée pour {config.owner}/{config.repo}.")
    
    # Retourne les logs DLT directement dans l'interface de Dagster
    return MaterializeResult(
        metadata={
            "owner": config.owner,
            "repo": config.repo,
            "depth": config.depth,
            "dlt_metrics": str(load_info),
        }
    )

@dbt_assets(manifest=dbt_project.manifest_path)
def github_gold_assets(context: AssetExecutionContext, dbt: DbtCliResource):
    yield from dbt.cli(["build"], context=context).stream()

defs = Definitions(
    assets=[extract_github_dependencies, github_gold_assets],
    resources={
        "dbt": DbtCliResource(project_dir=os.fspath(DBT_PROJECT_DIR)),
    },
)
