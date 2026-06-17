
  
    
    
    
        
         


        
  

  insert into `gold`.`dim_repository__dbt_backup`
        ("repo_id", "repo_name", "github_url", "ecosystem")

SELECT
    id as repo_id,
    name as repo_name,
    github_url,
    ecosystem
FROM `default`.`silver_components`
WHERE github_url IS NOT NULL
  