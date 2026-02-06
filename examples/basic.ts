/**
 * Exemplo básico de uso do FerresDB TypeScript SDK
 */

import { VectorDBClient, DistanceMetric } from "../src";

async function main() {
  // Cria uma instância do cliente
  const client = new VectorDBClient({
    baseUrl: "http://localhost:8080",
    timeout: 30000,
  });

  try {
    // Cria uma coleção
    console.log("Criando coleção...");
    const collection = await client.createCollection({
      name: "example-collection",
      dimension: 384,
      distance: DistanceMetric.Cosine,
    });
    console.log("Coleção criada:", collection.name);

    // Lista todas as coleções
    console.log("\nListando coleções...");
    const collections = await client.listCollections();
    console.log(`Total de coleções: ${collections.length}`);
    for (const col of collections) {
      console.log(`  - ${col.name} (dimensão: ${col.dimension})`);
    }

    // Insere pontos
    console.log("\nInserindo pontos...");
    const points = [
      {
        id: "point-1",
        vector: Array(384)
          .fill(0)
          .map(() => Math.random()),
        metadata: { text: "Primeiro documento", category: "tech" },
      },
      {
        id: "point-2",
        vector: Array(384)
          .fill(0)
          .map(() => Math.random()),
        metadata: { text: "Segundo documento", category: "science" },
      },
    ];

    const upsertResult = await client.upsertPoints(
      "example-collection",
      points,
    );
    console.log(
      `Inseridos: ${upsertResult.upserted}, Falhos: ${upsertResult.failed.length}`,
    );

    // Busca
    console.log("\nBuscando pontos similares...");
    const queryVector = Array(384)
      .fill(0)
      .map(() => Math.random());
    const results = await client.search("example-collection", {
      vector: queryVector,
      limit: 5,
    });

    console.log(`Encontrados ${results.length} resultados:`);
    for (const result of results) {
      console.log(`  - ID: ${result.id}, Score: ${result.score.toFixed(4)}`);
      console.log(`    Metadata:`, result.metadata);
    }

    // Busca com filtro
    console.log("\nBuscando com filtro...");
    const filteredResults = await client.search("example-collection", {
      vector: queryVector,
      limit: 10,
      filter: { category: "tech" },
    });
    console.log(
      `Encontrados ${filteredResults.length} resultados com category='tech'`,
    );

    // Limpeza (opcional)
    // await client.deleteCollection('example-collection');
    // console.log('\nColeção removida');
  } catch (error) {
    console.error("Erro:", error);
    process.exit(1);
  }
}

main().catch(console.error);
