

-- Repos are identified as parents in dependency_relations (they have dependents but are not dependencies themselves)
SELECT DISTINCT
    toUUID(rel.parent_id) as repo_id,
    c.name as repo_name,
    c.github_url
FROM `default`.`silver_dependency_relations` rel
JOIN `default`.`silver_components` c ON toString(c.id) = rel.parent_id
WHERE c.github_url IS NOT NULL