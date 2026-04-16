{{ config(materialized='table') }}

SELECT
    id as repo_id,
    name as repo_name,
    github_url,
    ecosystem
FROM {{ source('silver', 'silver_components') }}
WHERE github_url IS NOT NULL
