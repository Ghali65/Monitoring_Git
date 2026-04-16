

SELECT DISTINCT
    c.id as dependency_id,
    c.name,
    rel.version,
    c.purl
FROM `default`.`silver_components` c
JOIN `default`.`silver_dependency_relations` rel ON toString(c.id) = rel.child_id