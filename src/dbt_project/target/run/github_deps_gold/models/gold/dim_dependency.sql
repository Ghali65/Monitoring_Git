
  
    
    
    
        
         


        
  

  insert into `default`.`dim_dependency__dbt_backup`
        ("unique_id", "dependency_id", "name", "version", "ecosystem")

SELECT
    reinterpretAsUInt64(MD5(concat(toString(c.id), coalesce(r.version, '')))) as unique_id,
    c.id as dependency_id,
    c.name,
    r.version,
    c.ecosystem
FROM `default`.`silver_components` c
JOIN `default`.`silver_dependency_relations` r ON toString(c.id) = r.child_id
GROUP BY c.id, c.name, r.version, c.ecosystem
  