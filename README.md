# FerresDB TypeScript SDK

SDK TypeScript oficial para o FerresDB - banco de dados vetorial de alta performance.

## 📦 Instalação

```bash
pnpm add @ferres-db/typescript-sdk
# ou
npm install @ferres-db/typescript-sdk
# ou
yarn add @ferres-db/typescript-sdk
```

## 🚀 Quick Start

### Exemplo Básico

```typescript
import { VectorDBClient, DistanceMetric } from '@ferres-db/typescript-sdk';

// Cria uma instância do cliente
const client = new VectorDBClient({
  baseUrl: 'http://localhost:8080',
  timeout: 30000,
});

// Cria uma coleção
const collection = await client.createCollection({
  name: 'documents',
  dimension: 384, // Dimensão dos vetores (ex: all-MiniLM-L6-v2)
  distance: DistanceMetric.Cosine,
});

console.log('Coleção criada:', collection.name);

// Insere pontos
const points = [
  {
    id: 'doc-1',
    vector: [0.1, 0.2, 0.3, /* ... 384 dimensões */],
    metadata: { text: 'Primeiro documento', category: 'tech' },
  },
  {
    id: 'doc-2',
    vector: [0.4, 0.5, 0.6, /* ... 384 dimensões */],
    metadata: { text: 'Segundo documento', category: 'science' },
  },
];

const result = await client.upsertPoints('documents', points);
console.log(`Inseridos: ${result.upserted}, Falhos: ${result.failed.length}`);

// Busca os 5 pontos mais similares
const queryVector = [0.15, 0.25, 0.35, /* ... 384 dimensões */];
const results = await client.search('documents', {
  vector: queryVector,
  limit: 5,
});

for (const result of results) {
  console.log(`ID: ${result.id}, Score: ${result.score.toFixed(4)}`);
  console.log(`Metadata:`, result.metadata);
}
```

### Exemplo com Embeddings Reais

```typescript
import { VectorDBClient, DistanceMetric } from '@ferres-db/typescript-sdk';

// Assumindo que você tem uma função que gera embeddings
async function generateEmbedding(text: string): Promise<number[]> {
  // Use sua biblioteca de embeddings (OpenAI, Cohere, etc)
  // Retorna um vetor de 384 dimensões
  return []; // Placeholder
}

async function main() {
  const client = new VectorDBClient({
    baseUrl: 'http://localhost:8080',
  });

  // Cria a coleção
  await client.createCollection({
    name: 'documents',
    dimension: 384,
    distance: DistanceMetric.Cosine,
  });

  // Indexa documentos
  const documents = [
    'Rust é uma linguagem de programação',
    'Python é popular para machine learning',
    'Vector databases são úteis para RAG',
  ];

  const points = [];
  for (let i = 0; i < documents.length; i++) {
    const embedding = await generateEmbedding(documents[i]);
    points.push({
      id: `doc-${i}`,
      vector: embedding,
      metadata: { text: documents[i] },
    });
  }

  await client.upsertPoints('documents', points);

  // Busca semântica
  const queryEmbedding = await generateEmbedding('linguagem de programação');
  const results = await client.search('documents', {
    vector: queryEmbedding,
    limit: 3,
  });

  console.log('Documentos mais similares:');
  for (const result of results) {
    console.log(
      `  - ${result.metadata.text} (similaridade: ${result.score.toFixed(4)})`
    );
  }
}

main().catch(console.error);
```

### Exemplo com Filtros

```typescript
import { VectorDBClient } from '@ferres-db/typescript-sdk';

const client = new VectorDBClient({
  baseUrl: 'http://localhost:8080',
});

// Busca com filtro de metadata
const results = await client.search('documents', {
  vector: queryVector,
  limit: 10,
  filter: {
    category: 'tech', // Apenas documentos com category='tech'
  },
});
```

### Exemplo com Retry e Tratamento de Erros

```typescript
import {
  VectorDBClient,
  CollectionNotFoundError,
  CollectionAlreadyExistsError,
  InvalidDimensionError,
} from '@ferres-db/typescript-sdk';

const client = new VectorDBClient({
  baseUrl: 'http://localhost:8080',
  maxRetries: 5, // Número máximo de tentativas
  retryDelay: 1000, // Delay inicial em ms (exponential backoff)
});

try {
  await client.createCollection({
    name: 'my-collection',
    dimension: 384,
    distance: DistanceMetric.Cosine,
  });
} catch (error) {
  if (error instanceof CollectionAlreadyExistsError) {
    console.log('Coleção já existe');
  } else if (error instanceof InvalidDimensionError) {
    console.error('Dimensão inválida:', error.message);
  } else {
    console.error('Erro desconhecido:', error);
  }
}
```

## 📚 API Reference

### VectorDBClient

#### Constructor

```typescript
new VectorDBClient(options: VectorDBClientOptions)
```

**Opções:**

- `baseUrl` (string, obrigatório): URL base do servidor FerresDB (ex: `'http://localhost:8080'`)
- `timeout` (number, opcional): Timeout das requisições em ms (padrão: `30000`)
- `maxRetries` (number, opcional): Número máximo de tentativas em caso de erro (padrão: `3`)
- `retryDelay` (number, opcional): Delay inicial para retry em ms (padrão: `1000`)

#### Métodos

##### `createCollection(config: CollectionConfig): Promise<Collection>`

Cria uma nova coleção.

**Parâmetros:**
- `config.name` (string): Nome da coleção (apenas letras, números, hífens e underscores)
- `config.dimension` (number): Dimensão dos vetores (1-4096)
- `config.distance` (DistanceMetric): Métrica de distância

**Retorna:** Coleção criada

**Erros:**
- `CollectionAlreadyExistsError`: Se a coleção já existe
- `InvalidDimensionError`: Se a dimensão é inválida
- `InvalidPayloadError`: Se o payload é inválido

##### `listCollections(): Promise<Collection[]>`

Lista todas as coleções.

**Retorna:** Array de coleções

##### `deleteCollection(name: string): Promise<void>`

Remove uma coleção.

**Parâmetros:**
- `name` (string): Nome da coleção

**Erros:**
- `CollectionNotFoundError`: Se a coleção não existe

##### `upsertPoints(collection: string, points: Point[]): Promise<UpsertResult>`

Insere ou atualiza pontos em uma coleção. Automaticamente faz batching se houver mais de 1000 pontos.

**Parâmetros:**
- `collection` (string): Nome da coleção
- `points` (Point[]): Array de pontos para inserir/atualizar

**Retorna:** Resultado com número de pontos inseridos e lista de falhas

**Erros:**
- `CollectionNotFoundError`: Se a coleção não existe
- `InvalidDimensionError`: Se as dimensões dos vetores não correspondem

##### `deletePoints(collection: string, ids: string[]): Promise<void>`

Remove pontos de uma coleção pelos IDs.

**Parâmetros:**
- `collection` (string): Nome da coleção
- `ids` (string[]): Array de IDs dos pontos a remover

**Erros:**
- `CollectionNotFoundError`: Se a coleção não existe
- `InvalidPayloadError`: Se o array de IDs está vazio

##### `search(collection: string, query: SearchQuery): Promise<SearchResult[]>`

Busca pontos similares a um vetor de consulta.

**Parâmetros:**
- `collection` (string): Nome da coleção
- `query.vector` (number[]): Vetor de consulta
- `query.limit` (number): Número máximo de resultados
- `query.filter` (object, opcional): Filtro de metadata (equality matching)

**Retorna:** Array de resultados ordenados por similaridade

**Erros:**
- `CollectionNotFoundError`: Se a coleção não existe
- `InvalidDimensionError`: Se a dimensão do vetor não corresponde

### Tipos

#### `DistanceMetric`

```typescript
enum DistanceMetric {
  Cosine = 'Cosine',
  DotProduct = 'DotProduct',
  Euclidean = 'Euclidean',
}
```

#### `Point`

```typescript
interface Point {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}
```

#### `Collection`

```typescript
interface Collection {
  name: string;
  dimension: number;
  distance: DistanceMetric;
  created_at?: number;
}
```

#### `SearchResult`

```typescript
interface SearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}
```

#### `UpsertResult`

```typescript
interface UpsertResult {
  upserted: number;
  failed: Array<{
    id: string;
    reason: string;
  }>;
}
```

### Erros

Todos os erros herdam de `VectorDBError`:

- `CollectionNotFoundError`: Coleção não encontrada (404)
- `CollectionAlreadyExistsError`: Coleção já existe (409)
- `InvalidDimensionError`: Dimensão inválida (400)
- `InvalidPayloadError`: Payload inválido (400)
- `InternalError`: Erro interno do servidor (500)
- `ConnectionError`: Erro de conexão

## 🔧 Desenvolvimento

### Build

```bash
pnpm install
pnpm build
```

### Testes

```bash
pnpm test
pnpm test:watch
pnpm test:coverage
```

### Type Checking

```bash
pnpm typecheck
```

## 📝 Notas

- O SDK usa **Axios** para requisições HTTP com interceptors para tratamento de erros
- Validação runtime com **Zod** para garantir tipos corretos
- Retry automático com **exponential backoff** para erros de servidor (5xx) e conexão
- Suporte para **ESM** e **CJS** exports
- Batching automático para operações de upsert com mais de 1000 pontos

## 📄 Licença

MIT
