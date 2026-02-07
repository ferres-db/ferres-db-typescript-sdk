import { z } from "zod";

// ─── Distance Metric ──────────────────────────────────────────────────────

export enum DistanceMetric {
  Cosine = "Cosine",
  DotProduct = "DotProduct",
  Euclidean = "Euclidean",
}

const DistanceMetricSchema = z.nativeEnum(DistanceMetric);

// ─── Point ──────────────────────────────────────────────────────────────────

export interface Point {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export const PointSchema = z.object({
  id: z.string().min(1),
  vector: z.array(z.number()).min(1),
  metadata: z.record(z.unknown()).default({}),
});

// ─── Collection Config ──────────────────────────────────────────────────────

export interface CollectionConfig {
  name: string;
  dimension: number;
  distance: DistanceMetric;
  /** Enable BM25 index for hybrid search (default: false). */
  enable_bm25?: boolean;
  /** Metadata key used as text for BM25 (default: "text"). */
  bm25_text_field?: string;
}

export const CollectionConfigSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/, {
    message: "name can only contain letters, numbers, hyphens, and underscores",
  }),
  dimension: z.number().int().min(1).max(4096),
  distance: DistanceMetricSchema,
  enable_bm25: z.boolean().optional(),
  bm25_text_field: z.string().min(1).optional(),
});

// ─── Collection ────────────────────────────────────────────────────────────

export interface Collection {
  name: string;
  dimension: number;
  distance: DistanceMetric;
  created_at?: number;
}

export const CollectionSchema = z.object({
  name: z.string(),
  dimension: z.number().int(),
  distance: DistanceMetricSchema,
  created_at: z.number().optional(),
});

// ─── Collection List Item ───────────────────────────────────────────────────

export interface CollectionListItem {
  name: string;
  dimension: number;
  num_points: number;
  created_at: number;
}

export const CollectionListItemSchema = z.object({
  name: z.string(),
  dimension: z.number().int(),
  num_points: z.number().int(),
  created_at: z.number(),
});

// ─── Upsert Result ──────────────────────────────────────────────────────────

export interface FailedPoint {
  id: string;
  reason: string;
}

export interface UpsertResult {
  upserted: number;
  failed: FailedPoint[];
}

export const UpsertResultSchema = z.object({
  upserted: z.number().int(),
  failed: z.array(
    z.object({
      id: z.string(),
      reason: z.string(),
    }),
  ),
});

// ─── Search Query ────────────────────────────────────────────────────────────

export interface SearchQuery {
  vector: number[];
  limit: number;
  filter?: Record<string, unknown>;
  /** Max latency budget in ms. If estimated cost exceeds this, server returns 422. */
  budget_ms?: number;
}

export const SearchQuerySchema = z.object({
  vector: z.array(z.number()).min(1),
  limit: z.number().int().min(1),
  filter: z.record(z.unknown()).optional(),
  budget_ms: z.number().int().positive().optional(),
});

// ─── Search Result ──────────────────────────────────────────────────────────

export interface SearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export const SearchResultSchema = z.object({
  id: z.string(),
  score: z.number(),
  metadata: z.record(z.unknown()),
});

// ─── API Response Types ─────────────────────────────────────────────────────

export interface ListCollectionsResponse {
  collections: CollectionListItem[];
}

export const ListCollectionsResponseSchema = z.object({
  collections: z.array(CollectionListItemSchema),
});

export interface SearchPointsResponse {
  results: SearchResult[];
  took_ms: number;
}

export const SearchPointsResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  took_ms: z.number().int(),
});

// ─── API Keys ───────────────────────────────────────────────────────────────

export interface ApiKeyInfo {
  id: number;
  name: string;
  key_prefix: string;
  created_at: number;
}

export const ApiKeyInfoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  key_prefix: z.string(),
  created_at: z.number().int(),
});

export interface CreateKeyResponse {
  id: number;
  name: string;
  key: string;
  key_prefix: string;
  created_at: number;
}

export const CreateKeyResponseSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  key: z.string(),
  key_prefix: z.string(),
  created_at: z.number().int(),
});

// ─── Query Cost Estimation ───────────────────────────────────────────────

export interface CostBreakdown {
  index_scan_cost: number;
  filter_cost: number;
  hydration_cost: number;
  network_overhead: number;
}

export const CostBreakdownSchema = z.object({
  index_scan_cost: z.number(),
  filter_cost: z.number(),
  hydration_cost: z.number(),
  network_overhead: z.number(),
});

export interface QueryCostEstimate {
  estimated_ms: number;
  confidence_range: [number, number];
  estimated_memory_bytes: number;
  estimated_nodes_visited: number;
  is_expensive: boolean;
  recommendations: string[];
  breakdown: CostBreakdown;
}

export const QueryCostEstimateSchema = z.object({
  estimated_ms: z.number(),
  confidence_range: z.tuple([z.number(), z.number()]),
  estimated_memory_bytes: z.number().int(),
  estimated_nodes_visited: z.number().int(),
  is_expensive: z.boolean(),
  recommendations: z.array(z.string()),
  breakdown: CostBreakdownSchema,
});

export interface HistoricalLatency {
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  avg_ms: number;
  total_queries: number;
}

export const HistoricalLatencySchema = z.object({
  p50_ms: z.number(),
  p95_ms: z.number(),
  p99_ms: z.number(),
  avg_ms: z.number(),
  total_queries: z.number().int(),
});

export interface EstimateSearchResponse extends QueryCostEstimate {
  historical_latency?: HistoricalLatency;
}

export const EstimateSearchResponseSchema = QueryCostEstimateSchema.extend({
  historical_latency: HistoricalLatencySchema.optional(),
});

export interface EstimateSearchQuery {
  limit: number;
  filter?: Record<string, unknown>;
  include_history?: boolean;
}

export const EstimateSearchQuerySchema = z.object({
  limit: z.number().int().min(1),
  filter: z.record(z.unknown()).optional(),
  include_history: z.boolean().optional(),
});

// ─── Explain Query ──────────────────────────────────────────────────────

export interface ConditionResult {
  field: string;
  operator: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

export const ConditionResultSchema = z.object({
  field: z.string(),
  operator: z.string(),
  expected: z.unknown(),
  actual: z.unknown(),
  passed: z.boolean(),
});

export interface FilterExplanation {
  conditions: ConditionResult[];
  passed: boolean;
}

export const FilterExplanationSchema = z.object({
  conditions: z.array(ConditionResultSchema),
  passed: z.boolean(),
});

export interface ExplainResult {
  id: string;
  score: number;
  distance_metric: string;
  raw_distance: number;
  score_breakdown: Record<string, number>;
  filter_evaluation?: FilterExplanation;
  rank_before_filter: number;
  rank_after_filter: number;
}

export const ExplainResultSchema = z.object({
  id: z.string(),
  score: z.number(),
  distance_metric: z.string(),
  raw_distance: z.number(),
  score_breakdown: z.record(z.number()),
  filter_evaluation: FilterExplanationSchema.optional().nullable(),
  rank_before_filter: z.number().int(),
  rank_after_filter: z.number().int(),
});

export interface IndexStats {
  total_points: number;
  hnsw_layers: number;
  ef_search_used: number;
  tombstones_skipped: number;
}

export const IndexStatsSchema = z.object({
  total_points: z.number().int(),
  hnsw_layers: z.number().int(),
  ef_search_used: z.number().int(),
  tombstones_skipped: z.number().int(),
});

export interface SearchExplanation {
  query_vector_norm: number;
  distance_metric: string;
  candidates_scanned: number;
  candidates_after_filter: number;
  results: ExplainResult[];
  index_stats: IndexStats;
}

export const SearchExplanationSchema = z.object({
  query_vector_norm: z.number(),
  distance_metric: z.string(),
  candidates_scanned: z.number().int(),
  candidates_after_filter: z.number().int(),
  results: z.array(ExplainResultSchema),
  index_stats: IndexStatsSchema,
});

export interface ExplainSearchQuery {
  vector: number[];
  limit: number;
  filter?: Record<string, unknown>;
}

export const ExplainSearchQuerySchema = z.object({
  vector: z.array(z.number()).min(1),
  limit: z.number().int().min(1),
  filter: z.record(z.unknown()).optional(),
});

// ─── Client Options ─────────────────────────────────────────────────────────

export interface VectorDBClientOptions {
  baseUrl: string;
  /** API key for authentication. All data routes require Authorization: Bearer <apiKey>. */
  apiKey?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export const VectorDBClientOptionsSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).optional(),
  timeout: z.number().int().positive().optional().default(30000),
  maxRetries: z.number().int().min(0).optional().default(3),
  retryDelay: z.number().int().positive().optional().default(1000),
});
