

WITH base_advisory AS (
    SELECT
        _dlt_id,
        ghsa_id,
        cve_id,
        severity,
        summary,
        cvss__score
    FROM `default`.`silver_github_advisories`
),
cwes AS (
    SELECT
        _dlt_parent_id,
        groupArray(cwe_id) as cwe_list
    FROM `default`.`silver_github_advisories_cwes`
    GROUP BY _dlt_parent_id
)

SELECT
    a.ghsa_id as advisory_id,
    a.cve_id,
    CAST(
        CASE 
            WHEN lower(a.severity) = 'medium' THEN 'moderate'
            WHEN lower(a.severity) IN ('low', 'moderate', 'high', 'critical') THEN lower(a.severity)
            ELSE 'low' -- Fallback
        END, 
        'Enum8(\'low\' = 1, \'moderate\' = 2, \'high\' = 3, \'critical\' = 4)'
    ) as severity_label,
    a.summary,
    a.cvss__score,
    c.cwe_list,
    a._dlt_id as internal_id
FROM base_advisory a
LEFT JOIN cwes c ON a._dlt_id = c._dlt_parent_id