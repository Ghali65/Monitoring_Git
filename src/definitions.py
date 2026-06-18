"""
Point d'entrée Dagster pour le projet Git Monitor.

Définit les assets (extraction DLT, transformation DBT), les jobs et les
schedules enregistrés dans l'objet `defs` utilisé par dagster-webserver.
"""

import os
import sys
from pathlib import Path

import dlt
from dotenv import load_dotenv

ENV_PATH = Path(__file__).parent.parent / ".env"
load_dotenv(ENV_PATH)

sys.path.append(os.path.dirname(__file__))

from dagster import (  # noqa: E402
    AssetExecutionContext,
    AssetKey,
    AssetSelection,
    AssetSpec,
    Config,
    Definitions,
    MaterializeResult,
    ScheduleDefinition,
    define_asset_job,
    multi_asset,
)
from dagster_dbt import DagsterDbtTranslator, DbtCliResource, DbtProject, dbt_assets  # noqa: E402

from github_deps_tracker.dependency_fetcher import fetch_dependencies_resource  # noqa: E402
from vulnerability.request_v import fetch_advisories  # noqa: E402

PROJECT_ROOT = Path(__file__).joinpath("..").resolve()
DBT_PROJECT_DIR = PROJECT_ROOT.joinpath("dbt_project").resolve()
dbt_project = DbtProject(project_dir=DBT_PROJECT_DIR)

os.environ["DLT_PROJECT_DIR"] = os.fspath(PROJECT_ROOT / "github_deps_tracker")


class CustomDagsterDbtTranslator(DagsterDbtTranslator):
    """Traduit les nœuds dbt en AssetKey Dagster en les faisant correspondre aux assets DLT."""

    def get_asset_key(self, dbt_resource_props):
        """Retourne l'AssetKey Dagster correspondant à la source ou au modèle dbt."""
        resource_type = dbt_resource_props.get("resource_type")
        name = dbt_resource_props.get("name")

        if resource_type == "source":
            mapping_vulnerability = {
                "silver_github_advisories": "github_advisories",
                "silver_github_advisories_cwes": "github_advisories_cwes",
                "silver_github_advisories_vulnerabilities": "github_advisories_vulnerabilities",
            }
            if name in mapping_vulnerability:
                return AssetKey(mapping_vulnerability[name])

            mapping_deps = {
                "silver_components": "github_components",
                "silver_dependency_relations": "github_dependency_relations",
            }
            if name in mapping_deps:
                return AssetKey(mapping_deps[name])

        return super().get_asset_key(dbt_resource_props)


class GithubDepsConfig(Config):
    """Configuration Dagster pour l'asset d'extraction des dépendances GitHub."""

    owner: str = "facebook"
    repo: str = "react"
    depth: int = 2


@multi_asset(
    specs=[
        AssetSpec("github_components", group_name="github_extraction"),
        AssetSpec("github_dependency_relations", group_name="github_extraction"),
    ],
    compute_kind="python",
    description="Extraction des composants et relations de dépendances via DLT.",
)
def extract_github_dependencies(context, config: GithubDepsConfig):
    """Extrait les composants et relations de dépendances d'un dépôt GitHub via DLT."""
    context.log.info(f"Démarrage de l'extraction DLT pour le repo : {config.owner}/{config.repo}")

    pipeline = dlt.pipeline(
        pipeline_name="github_deps_tracker",
        destination="filesystem",
        dataset_name="graph_data",
    )

    load_info = pipeline.run(
        fetch_dependencies_resource(config.owner, config.repo, config.depth)
    )

    context.log.info(f"Extraction terminée pour {config.owner}/{config.repo}.")

    yield MaterializeResult(asset_key="github_components", metadata={"dlt_metrics": str(load_info)})
    yield MaterializeResult(
        asset_key="github_dependency_relations", metadata={"dlt_metrics": str(load_info)}
    )


@multi_asset(
    specs=[
        AssetSpec("github_advisories", group_name="vulnerability_extraction"),
        AssetSpec("github_advisories_cwes", group_name="vulnerability_extraction"),
        AssetSpec("github_advisories_vulnerabilities", group_name="vulnerability_extraction"),
    ],
    compute_kind="python",
    description="Extraction incrémentale des vulnérabilités et leurs métadonnées via DLT.",
)
def extract_github_vulnerabilities(context):
    """Extrait de manière incrémentale les advisories GitHub et leurs métadonnées via DLT."""
    context.log.info("Démarrage de l'extraction DLT pour les vulnérabilités GitHub")

    pipeline = dlt.pipeline(
        pipeline_name="github_vulnerabilities_v2",
        destination="filesystem",
        dataset_name="bronze_layer",
    )

    load_info = pipeline.run(
        fetch_advisories(),
        loader_file_format="jsonl",
    )

    context.log.info("Extraction terminée pour les vulnérabilités.")

    yield MaterializeResult(asset_key="github_advisories", metadata={"dlt_metrics": str(load_info)})
    yield MaterializeResult(
        asset_key="github_advisories_cwes", metadata={"dlt_metrics": str(load_info)}
    )
    yield MaterializeResult(
        asset_key="github_advisories_vulnerabilities", metadata={"dlt_metrics": str(load_info)}
    )


@dbt_assets(
    manifest=dbt_project.manifest_path,
    dagster_dbt_translator=CustomDagsterDbtTranslator(),
)
def github_gold_assets(context: AssetExecutionContext, dbt: DbtCliResource):
    """Exécute `dbt build` pour matérialiser les modèles Gold depuis la couche Silver."""
    yield from dbt.cli(["build"], context=context).stream()


vulnerability_sync_job = define_asset_job(
    name="vulnerability_sync_job",
    selection=AssetSelection.groups("vulnerability_extraction").downstream(),
)

dbt_build_job = define_asset_job(
    name="dbt_build_job",
    selection=AssetSelection.assets(github_gold_assets),
)

# Déclenché par le backend (pas de schedule automatique)
github_dependencies_job = define_asset_job(
    name="github_dependencies_job",
    selection=AssetSelection.groups("github_extraction").downstream(),
)

vulnerability_schedule = ScheduleDefinition(
    job=vulnerability_sync_job,
    cron_schedule="0 */2 * * *",
)

# 40 min d'écart pour laisser le temps au S3Queue d'ingérer les fichiers DLT
gold_schedule = ScheduleDefinition(
    name="gold_schedule",
    job=dbt_build_job,
    cron_schedule="40 */2 * * *",
)

defs = Definitions(
    assets=[
        extract_github_dependencies,
        extract_github_vulnerabilities,
        github_gold_assets,
    ],
    jobs=[vulnerability_sync_job, dbt_build_job, github_dependencies_job],
    schedules=[vulnerability_schedule, gold_schedule],
    resources={
        "dbt": DbtCliResource(project_dir=os.fspath(DBT_PROJECT_DIR)),
    },
)
