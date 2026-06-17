

-- A true repo is a root node: it appears as parent_id but never as child_id
SELECT DISTINCT
    toUUID(rel.parent_id) as repo_id,
    c.name as repo_name,
    c.github_url
FROM `default`.`silver_dependency_relations` rel
JOIN `default`.`silver_components` c ON toString(c.id) = rel.parent_id
WHERE c.github_url IS NOT NULL
  AND rel.parent_id NOT IN (
      SELECT DISTINCT child_id
      FROM `default`.`silver_dependency_relations`
      WHERE child_id IS NOT NULL
  )