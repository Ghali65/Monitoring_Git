import dlt
from dlt.sources.filesystem import filesystem, read_jsonl

def main():
    print("🚀 Démarrage du Pipeline DLT : Data Lake (S3) -> Data Warehouse (PostgreSQL)")

    # 1. On déclare le pipeline avec la destination Postgres
    pipeline = dlt.pipeline(
        pipeline_name="minio_to_postgres",
        destination="postgres",
        dataset_name="bronze" 
    )

    # 2. On instancie la source Filesystem pointant vers S3 avec le bon glob
    # Cela va lire la configuration [sources.filesystem] depuis .dlt/secrets.toml
    print("📦 Recherche des archives graph_data (JSONL.gz) sur MinIO...")
    
    components_raw = filesystem(file_glob="graph_data/components/**/*.jsonl.gz")
    relations_raw = filesystem(file_glob="graph_data/dependency_relations/**/*.jsonl.gz")

    # 3. On extrait et on charge.
    # On ajoute le "transformer" read_jsonl qui va décompresser à la volée
    # et lire le contenu ligne par ligne (qui deviendront tes lignes SQL).
    parsed_components = components_raw | read_jsonl()
    parsed_relations = relations_raw | read_jsonl()

    try:
        # Lancement du chargement S3 -> Postgres
        print("⚡ Ingestion massive en cours vers PostgreSQL (46.224.33.190)...")
        load_info = pipeline.run([
            # On donne le nom de table désiré via `with_name` pour forcer DLT 
            # à ranger le Jsonl dans la bonne table.
            parsed_components.with_name("components"),
            parsed_relations.with_name("dependency_relations")
        ])
        
        print("\n--- ✅ Succès du transfert vers PostgreSQL ! ---")
        print(load_info)
        
    except Exception as e:
        print(f"\n❌ Erreur lors de l'exécution: {e}")

if __name__ == "__main__":
    main()
