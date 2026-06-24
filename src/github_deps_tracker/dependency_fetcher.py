"""
Logique d'extraction DLT.

Parcourt l'arbre de dépendances GitHub (BFS) et alimente les tables
`components` et `dependency_relations`.
"""

import uuid
from datetime import UTC, datetime

import dlt

from github_deps_tracker.config import load_config
from github_deps_tracker.github_client import GitHubGraphQLClient


def get_ecosystem_from_manifest(manifest: str) -> str:
    """Déduit l'écosystème du registre à partir du nom du fichier manifest de Github."""
    if not manifest:
        return "unknown"
    manifest = manifest.lower()
    if any(ext in manifest for ext in ["requirements.txt", "pyproject", "setup.py", "pipfile"]):
        return "pypi"
    if any(ext in manifest for ext in ["package.json", "yarn.lock"]):
        return "npm"
    if "pom.xml" in manifest:
        return "maven"
    if "gemfile" in manifest:
        return "rubygems"
    if "composer.json" in manifest:
        return "packagist"
    if "go.mod" in manifest:
        return "golang"
    if ".github/workflows" in manifest:
        return "githubactions"
    return "unknown"


def extract_dependencies(graphql_data: dict) -> list:
    """Extrait les nœuds de dépendances utiles depuis la réponse JSON GraphQL."""
    dependencies_list = []
    repo_node = graphql_data.get("data", {}).get("repository")
    if not repo_node:
        return []

    manifests = repo_node.get("dependencyGraphManifests", {}).get("nodes", [])
    if not manifests:
        return []

    for manifest in manifests:
        deps = manifest.get("dependencies", {}).get("nodes", [])
        if not deps:
            continue

        for dep in deps:
            dep_info = {
                "manifest": manifest.get("filename"),
                "packageName": dep.get("packageName"),
                "requirements": dep.get("requirements"),
                "hasDependencies": dep.get("hasDependencies"),
                "repository": dep.get("repository"),
            }
            dependencies_list.append(dep_info)

    return dependencies_list


@dlt.resource(name="github_repo_dependencies", write_disposition="append")
def fetch_dependencies_resource(target_owner: str, target_repo: str, max_depth: int = 2):
    """
    Générateur DLT (BFS) sur l'arbre de dépendances d'un dépôt GitHub.

    Alimente les tables `components` et `dependency_relations` via `dlt.mark.with_table_name`.
    """
    config = load_config()
    client = GitHubGraphQLClient(config["GITHUB_TOKEN"])

    visited = set()
    queue = [(target_owner, target_repo, 1)]

    print(
        f"Lancement du générateur DLT structuré pour {target_owner}/{target_repo}"
        f" (Profondeur fixée: {max_depth})..."
    )

    while queue:
        current_owner, current_repo, current_depth = queue.pop(0)

        identifier = f"{current_owner}/{current_repo}"
        if identifier in visited:
            continue

        visited.add(identifier)
        print(f"[{current_depth}/{max_depth}] Extraction DLT : {identifier}...")

        try:
            raw_data = client.fetch_dependencies(current_owner, current_repo)
        except Exception as e:
            print(f"   -> Ignoré, erreur API : {e}")
            continue

        dependencies = extract_dependencies(raw_data)

        root_purl = f"pkg:github/{current_owner}/{current_repo}"
        root_id = str(uuid.uuid5(uuid.NAMESPACE_URL, root_purl))

        yield dlt.mark.with_table_name(
            {
                "id": root_id,
                "purl": root_purl,
                "name": current_repo,
                "ecosystem": "github",
                "github_url": f"https://github.com/{current_owner}/{current_repo}",
                "last_update": datetime.now(UTC).isoformat(),
                "is_initial": current_depth == 1,
            },
            "components",
        )

        print(f"   -> {len(dependencies)} dépendances. Injection format relationnel aux tables.")

        for dep in dependencies:
            manifest = dep.get("manifest", "")
            pack_name = dep.get("packageName", "unknown")
            eco = get_ecosystem_from_manifest(manifest)

            dep_purl = f"pkg:{eco}/{pack_name}"

            repo_info = dep.get("repository")
            github_url = None
            if repo_info:
                o = repo_info.get("owner", {}).get("login")
                n = repo_info.get("name")
                if o and n:
                    github_url = f"https://github.com/{o}/{n}"

            dep_id = str(uuid.uuid5(uuid.NAMESPACE_URL, dep_purl))

            yield dlt.mark.with_table_name(
                {
                    "id": dep_id,
                    "purl": dep_purl,
                    "name": pack_name,
                    "ecosystem": eco,
                    "github_url": github_url,
                    "last_update": datetime.now(UTC).isoformat(),
                    "is_initial": False,
                },
                "components",
            )

            raw_version = dep.get("requirements")
            ver = raw_version if raw_version else None  # string vide → null SQL

            yield dlt.mark.with_table_name(
                {
                    "parent_id": root_id,
                    "child_id": dep_id,
                    "version": ver,
                    "depth": current_depth,
                    "detected_at": datetime.now(UTC).isoformat(),
                },
                "dependency_relations",
            )

            if current_depth < max_depth and repo_info:
                dep_owner = repo_info.get("owner", {}).get("login")
                dep_name = repo_info.get("name")

                if dep_owner and dep_name:
                    child_identifier = f"{dep_owner}/{dep_name}"
                    if child_identifier not in visited:
                        queue.append((dep_owner, dep_name, current_depth + 1))
