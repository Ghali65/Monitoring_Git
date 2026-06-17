import os
from dagster import Config, asset, MaterializeResult, Definitions, AssetExecutionContext, ScheduleDefinition, define_asset_job, AssetSelection
from dagster_dbt import DbtCliResource, dbt_assets, DbtProject
import dlt
from pathlib import Path

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.environ["DLT_PROJECT_DIR"] = os.path.join(PROJECT_ROOT, "github_deps_tracker")

import sys
sys.path.append(os.path.dirname(__file__))
sys.path.append(os.path.join(PROJECT_ROOT, "vulnerability"))
from dependency_fetcher import fetch_dependencies_resource
from request_v import fetch_advisories

DBT_PROJECT_DIR = Path(__file__).joinpath("..", "..", "dbt_project").resolve()
dbt_project = DbtProject(project_dir=DBT_PROJECT_DIR)

class GithubDepsConfig(Config):
    owner: str = "facebook"
    repo: str = "react"
    depth: int = 2

@asset(
    compute_kind="python",
    group_name="github_extraction",
    description="Extraction des dépendances GitHub via DLT vers MinIO (bronze/dependencies)."
)
def extract_github_dependencies(context, config: GithubDepsConfig):
    context.log.info(f"Démarrage extraction DLT dépendances : {config.owner}/{config.repo}")

    pipeline = dlt.pipeline(
        pipeline_name="github_deps_tracker",
        destination="filesystem",
        dataset_name="graph_data"
    )

    load_info = pipeline.run(
        fetch_dependencies_resource(config.owner, config.repo, config.depth)
    )

    context.log.info(f"Extraction dépendances terminée : {config.owner}/{config.repo}")

    return MaterializeResult(
        metadata={
            "owner": config.owner,
            "repo": config.repo,
            "depth": config.depth,
            "dlt_metrics": str(load_info),
        }
    )

@asset(
    compute_kind="python",
    group_name="github_extraction",
    description="Extraction incrémentale des advisories GitHub via DLT vers MinIO (bronze/bronze_layer)."
)
def extract_github_advisories(context):
    context.log.info("Démarrage extraction DLT advisories GitHub...")

    # bucket_url explicitement à s3://bronze (sans /dependencies)
    # pour correspondre au chemin attendu par queue_github_advisories : bronze/bronze_layer/**
    pipeline = dlt.pipeline(
        pipeline_name="github_vulnerabilities_v2",
        destination=dlt.destinations.filesystem(bucket_url="s3://bronze"),
        dataset_name="bronze_layer"
    )

    load_info = pipeline.run(
        fetch_advisories(),
        loader_file_format="jsonl"
    )

    context.log.info("Extraction advisories terminée.")

    return MaterializeResult(
        metadata={"dlt_metrics": str(load_info)}
    )

@dbt_assets(manifest=dbt_project.manifest_path)
def github_gold_assets(context: AssetExecutionContext, dbt: DbtCliResource):
    yield from dbt.cli(["build"], context=context).stream()

# Job extraction (DLT → MinIO)
extraction_job = define_asset_job(
    name="extraction_job",
    selection=AssetSelection.assets(extract_github_dependencies, extract_github_advisories),
)

# Job transformation (MinIO → Silver → Gold via DBT)
# S'exécute après l'extraction pour avoir des données fraîches
gold_job = define_asset_job(
    name="gold_job",
    selection=AssetSelection.assets(github_gold_assets),
)

# Extraction toutes les 2h
extraction_schedule = ScheduleDefinition(
    name="extraction_schedule",
    cron_schedule="0 */2 * * *",
    job=extraction_job,
)

# DBT gold 15 min après l'extraction (laisser le temps au S3Queue d'ingérer)
gold_schedule = ScheduleDefinition(
    name="gold_schedule",
    cron_schedule="40 */2 * * *",
    job=gold_job,
)

defs = Definitions(
    assets=[extract_github_dependencies, extract_github_advisories, github_gold_assets],
    jobs=[extraction_job, gold_job],
    schedules=[extraction_schedule, gold_schedule],
    resources={
        "dbt": DbtCliResource(project_dir=os.fspath(DBT_PROJECT_DIR)),
    },
)
