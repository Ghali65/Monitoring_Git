import { NextResponse } from 'next/server';

const DAGSTER_URL = process.env.DAGSTER_URL || "http://127.0.0.1:3000";
const DAGSTER_GRAPHQL_URL = `${DAGSTER_URL}/graphql`;

export async function POST(req: Request) {
  try {
    const { owner, repo, depth = 2 } = await req.json();

    if (!owner || !repo) {
      return NextResponse.json({ error: "Missing owner or repo" }, { status: 400 });
    }

    const mutation = `
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
    `;

    const run_config = {
        ops: {
            extract_github_dependencies: {
                config: {
                    owner: owner,
                    repo: repo,
                    depth: depth,
                }
            }
        }
    };

    const variables = {
        repositoryLocationName: "monorepo_data",
        repositoryName: "__repository__",
        jobName: "github_dependencies_job",
        runConfigData: run_config,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(DAGSTER_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: mutation, variables }),
        signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
        throw new Error(`Dagster returned status ${response.status}`);
    }

    const data = await response.json();
    const result_data = data?.data?.launchRun || {};
    const typename = result_data.__typename;

    if (typename !== "LaunchRunSuccess") {
        const error_msg = result_data.message || "Pas de message d'erreur précis";
        return NextResponse.json({ error: `Dagster a refusé le run (Type: ${typename}) : ${error_msg}` }, { status: 500 });
    }

    const run_id = result_data.run.runId;

    return NextResponse.json({
        status: "success",
        owner,
        repo,
        dataset_name: "graph_data",
        message: `Run Dagster lancé pour ${owner}/${repo}. Visible dans l'interface.`,
        result: `run_id=${run_id}`,
    });
  } catch (error: any) {
    console.error("Dagster trigger error:", error);
    return NextResponse.json({ error: `Impossible de contacter Dagster (${DAGSTER_URL}) : ${error.message}` }, { status: 503 });
  }
}
