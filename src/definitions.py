import os
import sys
from pathlib import Path
import dlt

# On force l'ajout du dossier src au PYTHONPATH pour trouver les sous-modules
sys.path.append(os.path.dirname(__file__))

from dagster import (
    Definitions,
    define_asset_job,
    ScheduleDefinition,
    AssetSelection,
    AssetExecutionContext,
    asset,
    multi_asset,
    AssetSpec,
    MaterializeResult,
    Config,
    AssetKey,
)
from dagster_dbt import DbtCliResource, dbt_assets, DbtProject, DagsterDbtTranslator

# --- IMPORTS DE LA LOGIQUE MÉTIER ---
from github_deps_tracker.dependency_fetcher import fetch_dependencies_resource
from vulnerability.request_v import fetch_advisories

# --- CONFIGURATION ---
PROJECT_ROOT = Path(__file__).joinpath("..").resolve()
DBT_PROJECT_DIR = PROJECT_ROOT.joinpath("dbt_project").resolve()
dbt_project = DbtProject(project_dir=DBT_PROJECT_DIR)

# Configuration DLT pour trouver les dossiers .dlt respectifs
os.environ["DLT_PROJECT_DIR"] = os.fspath(PROJECT_ROOT / "github_deps_tracker")


# --- TRADUCTEUR DBT (Liaison DLT -> DBT) ---

class CustomDagsterDbtTranslator(DagsterDbtTranslator):
    def get_asset_key(self, dbt_resource_props):
        resource_type = dbt_resource_props.get("resource_type")
        name = dbt_resource_props.get("name")
        
        if resource_type == "source":
            # Mapping précis pour les vulnérabilités
            mapping_vulnerability = {
                "silver_github_advisories": "github_advisories",
                "silver_github_advisories_cwes": "github_advisories_cwes",
                "silver_github_advisories_vulnerabilities": "github_advisories_vulnerabilities",
            }
            if name in mapping_vulnerability:
                return AssetKey(mapping_vulnerability[name])

            # Mapping précis pour les dépendances
            mapping_deps = {
                "silver_components": "github_components",
                "silver_dependency_relations": "github_dependency_relations",
            }
            if name in mapping_deps:
                return AssetKey(mapping_deps[name])

        return super().get_asset_key(dbt_resource_props)


# --- ASSETS DAGSTER ---

class GithubDepsConfig(Config):
    owner: str = "facebook"
    repo: str = "react"
    depth: int = 2


@multi_asset(
    specs=[
        AssetSpec("github_components", group_name="github_extraction"),
        AssetSpec("github_dependency_relations", group_name="github_extraction"),
    ],
    compute_kind="python",
    description="Extraction des composants et relations de dépendances via DLT."
)
def extract_github_dependencies(context, config: GithubDepsConfig):
    context.log.info(f"Démarrage de l'extraction DLT pour le repo : {config.owner}/{config.repo}")
    
    pipeline = dlt.pipeline(
        pipeline_name="github_deps_tracker",
        destination="filesystem",
        dataset_name="graph_data"
    )

    load_info = pipeline.run(
        fetch_dependencies_resource(config.owner, config.repo, config.depth)
    )

    context.log.info(f"Extraction terminée pour {config.owner}/{config.repo}.")
    
    # Retourner un tuple de MaterializeResult pour chaque spec du multi_asset
    return (
        MaterializeResult(asset_key="github_components", metadata={"dlt_metrics": str(load_info)}),
        MaterializeResult(asset_key="github_dependency_relations", metadata={"dlt_metrics": str(load_info)})
    )


@multi_asset(
    specs=[
        AssetSpec("github_advisories", group_name="vulnerability_extraction"),
        AssetSpec("github_advisories_cwes", group_name="vulnerability_extraction"),
        AssetSpec("github_advisories_vulnerabilities", group_name="vulnerability_extraction"),
    ],
    compute_kind="python",
    description="Extraction incrémentale des vulnérabilités et leurs métadonnées via DLT."
)
def extract_github_vulnerabilities(context):
    context.log.info("Démarrage de l'extraction DLT pour les vulnérabilités GitHub")

    pipeline = dlt.pipeline(
        pipeline_name="github_vulnerabilities_v2",
        destination="filesystem",
        dataset_name="bronze_layer"
    )

    load_info = pipeline.run(
        fetch_advisories(),
        loader_file_format="jsonl"
    )

    context.log.info("Extraction terminée pour les vulnérabilités.")

    # Retourner un tuple de MaterializeResult pour chaque spec du multi_asset
    return (
        MaterializeResult(asset_key="github_advisories", metadata={"dlt_metrics": str(load_info)}),
        MaterializeResult(asset_key="github_advisories_cwes", metadata={"dlt_metrics": str(load_info)}),
        MaterializeResult(asset_key="github_advisories_vulnerabilities", metadata={"dlt_metrics": str(load_info)})
    )


@dbt_assets(
    manifest=dbt_project.manifest_path,
    dagster_dbt_translator=CustomDagsterDbtTranslator()
)
def github_gold_assets(context: AssetExecutionContext, dbt: DbtCliResource):
    yield from dbt.cli(["build"], context=context).stream()


# --- JOBS & SCHEDULES ---

# Job pour synchroniser Vulnerabilités DLT + DBT
# On utilise la sélection par groupe pour inclure tous les multi-assets
vulnerability_sync_job = define_asset_job(
    name="vulnerability_sync_job",
    selection=AssetSelection.groups("vulnerability_extraction").downstream(),
)

# Job pour lancer l’extraction de dépendances GitHub via DLT
github_dependencies_job = define_asset_job(
    name="github_dependencies_job",
    selection=AssetSelection.assets(extract_github_dependencies),
)

# Job global pour DBT seul
dbt_build_job = define_asset_job(
    name="dbt_build_job",
    selection=AssetSelection.assets(github_gold_assets),
)

# Planification toutes les 2 heures
vulnerability_schedule = ScheduleDefinition(
    job=vulnerability_sync_job,
    cron_schedule="0 */2 * * *",
)


# --- DEFINITIONS ---
defs = Definitions(
    assets=[
        extract_github_dependencies,
        extract_github_vulnerabilities,
        github_gold_assets,
    ],
    jobs=[vulnerability_sync_job, github_dependencies_job, dbt_build_job],
    schedules=[vulnerability_schedule],
    resources={
        "dbt": DbtCliResource(project_dir=os.fspath(DBT_PROJECT_DIR)),
    },
)
