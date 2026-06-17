import os
import sys
import time
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Ajouter le dossier src au PYTHONPATH
SRC_ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(SRC_ROOT))

# URL de l'instance Dagster (lancée via `dagster dev`)
DAGSTER_URL = os.getenv("DAGSTER_URL", "http://127.0.0.1:3000")
DAGSTER_GRAPHQL_URL = f"{DAGSTER_URL}/graphql"

app = FastAPI(
    title="GitHub Dependency Tracker API",
    description="API pour déclencher l'analyse de dépendances GitHub depuis l'interface React.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)


class TriggerAnalysisRequest(BaseModel):
    owner: str = Field(..., min_length=1, example="facebook")
    repo: str = Field(..., min_length=1, example="react")
    depth: int = Field(2, ge=1, le=5, description="Profondeur de recherche des dépendances")


class TriggerAnalysisResponse(BaseModel):
    status: str
    owner: str
    repo: str
    dataset_name: str
    message: str
    result: str


@app.post("/api/trigger-analysis", response_model=TriggerAnalysisResponse)
def trigger_analysis(request: TriggerAnalysisRequest):
    # Requête GraphQL pour déclencher un job Dagster
    # On utilise launchRun pour lancer le job 'github_dependencies_job'
    # qui est déclaré dans src/definitions.py
    mutation = """
    mutation LaunchRun($repositoryLocationName: String!, $repositoryName: String!, $jobName: String!, $runConfigData: RunConfigData!) {
      launchRun(
        executionParams: {
          selector: {
            repositoryLocationName: $repositoryLocationName,
            repositoryName: $repositoryName,
            jobName: $jobName
          },
          runConfigData: $runConfigData
        }
      ) {
        __typename
        ... on LaunchRunSuccess {
          run { runId status }
        }
        ... on PythonError {
          message
        }
        ... on InvalidSubsetError {
          message
        }
        ... on RunConflict {
          message
        }
      }
    }
    """

    run_config = {
        "ops": {
            "extract_github_dependencies": {
                "config": {
                    "owner": request.owner,
                    "repo": request.repo,
                    "depth": request.depth,
                }
            }
        }
    }

    variables = {
        "repositoryLocationName": "monorepo_data",
        "repositoryName": "__repository__",
        "jobName": "github_dependencies_job",
        "runConfigData": run_config,
    }

    try:
        response = requests.post(
            DAGSTER_GRAPHQL_URL,
            json={"query": mutation, "variables": variables},
            timeout=15
        )
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as error:
        raise HTTPException(
            status_code=503,
            detail=f"Impossible de contacter Dagster ({DAGSTER_URL}) : {error}"
        )

    result_data = data.get("data", {}).get("launchRun", {})
    typename = result_data.get("__typename")

    if typename != "LaunchRunSuccess":
        error_msg = result_data.get("message", "Pas de message d'erreur précis")
        raise HTTPException(
            status_code=500, 
            detail=f"Dagster a refusé le run (Type: {typename}) : {error_msg}"
        )

    run_id = result_data["run"]["runId"]

    return TriggerAnalysisResponse(
        status="success",
        owner=request.owner,
        repo=request.repo,
        dataset_name="graph_data",
        message=f"Run Dagster lancé pour {request.owner}/{request.repo}. Visible dans l'interface.",
        result=f"run_id={run_id}",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        app_dir=str(Path(__file__).parent),
    )
