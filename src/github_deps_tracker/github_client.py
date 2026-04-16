import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


DEPENDENCY_GRAPH_QUERY = """
query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    dependencyGraphManifests(first: 100) {
      nodes {
        filename
        dependencies(first: 100) {
          nodes {
            packageName
            requirements
            hasDependencies
            repository {
              name
              owner {
                login
              }
            }
          }
        }
      }
    }
  }
}
"""


class GitHubGraphQLClient:
    """
    Client pour interagir avec l'API GraphQL de GitHub.
    """
    API_URL = "https://api.github.com/graphql"

    def __init__(self, token: str):
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.hawkgirl-preview+json"
        }
        
        self.session = requests.Session()
        
        # Configuration des essais automatiques sur les erreurs serveurs (5xx)
        retry_strategy = Retry(
            total=3,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["POST"],
            backoff_factor=1
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount("https://", adapter)

    def fetch_dependencies(self, owner: str, repo: str) -> dict:
        """
        Exécute la requête GraphQL pour récupérer le graphe de dépendances d'un dépôt.
        """
        variables = {
            "owner": owner,
            "name": repo
        }

        payload = {
            "query": DEPENDENCY_GRAPH_QUERY,
            "variables": variables
        }

        max_attempts = 3
        
        for attempt in range(max_attempts):
            try:
                response = self.session.post(
                    self.API_URL,
                    json=payload,
                    headers=self.headers,
                    timeout=30
                )
                
                response.raise_for_status()
                data = response.json()

                if "errors" in data:
                    err_str = str(data["errors"]).lower()
                    if "timedout" in err_str and attempt < max_attempts - 1:
                        print(f"      [GraphQL Timeout Interne] Nouvel essai ({attempt + 1}/{max_attempts})...")
                        time.sleep(3)
                        continue
                    else:
                        raise ValueError(f"Erreur GraphQL: {data['errors']}")

                return data

            except requests.exceptions.Timeout as e:
                if attempt < max_attempts - 1:
                    print(f"      [Timeout Réseau] Nouvel essai ({attempt + 1}/{max_attempts})...")
                    time.sleep(3)
                    continue
                raise ValueError(f"Timeout réseau définitif : {e}")
