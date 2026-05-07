{{ config(materialized='table') }}

SELECT
    reinterpretAsUInt64(MD5(concat(toString(c.id), coalesce(r.version, '')))) as unique_id,
    c.id as dependency_id,
    c.name,
    r.version,
    c.ecosystem
FROM {{ source('silver', 'silver_components') }} c
JOIN {{ source('silver', 'silver_dependency_relations') }} r ON toString(c.id) = r.child_id
GROUP BY c.id, c.name, r.version, c.ecosystem
