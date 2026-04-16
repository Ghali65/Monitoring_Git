{{ config(materialized='table') }}

SELECT DISTINCT
    c.id as dependency_id,
    c.name,
    rel.version,
    c.purl
FROM {{ source('silver', 'silver_components') }} c
JOIN {{ source('silver', 'silver_dependency_relations') }} rel ON toString(c.id) = rel.child_id
