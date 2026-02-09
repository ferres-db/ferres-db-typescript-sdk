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
  /** Logical namespace (multitenancy). When set, point is scoped to this namespace. */
  namespace?: string;
  /** TTL in seconds; point expires and is removed by vacuum worker after this time. */
  ttl?: number;
  /** Named additional vectors (e.g. title_vector, content_vector). Each must match collection dimension. */
  vectors?: Record<string, number[]>;
}

export const PointSchema = z.object({
  id: z.string().min(1),
  vector: z.array(z.number()).min(1),
  metadata: z.record(z.unknown()).default({}),
  namespace: z.string().optional(),
  ttl: z.number().int().positive().optional(),
  vectors: z.record(z.string(), z.array(z.number())).optional(),
});

// ─── Scalar Quantization (SQ8) ───────────────────────────────────────────

export enum ScalarType {
  Int8 = "Int8",
}

const ScalarTypeSchema = z.nativeEnum(ScalarType);

export interface ScalarQuantizationConfig {
  dtype: ScalarType;
  /** Keep original f32 vectors in RAM for re-ranking (default: false). */
  always_ram?: boolean;
  /** Percentile used for min/max calibration, 0-100 (default: 99.5). */
  quantile?: number;
}

export const ScalarQuantizationConfigSchema = z.object({
  dtype: ScalarTypeSchema,
  always_ram: z.boolean().optional(),
  quantile: z.number().min(0).max(100).optional(),
});

/**
 * Quantization configuration for a collection.
 *
 * Matches the server's tagged-enum format:
 * - `"None"` — no quantization (default)
 * - `{ Scalar: { dtype: "Int8", ... } }` — SQ8 compression
 */
export type QuantizationConfig = "None" | { Scalar: ScalarQuantizationConfig };

export const QuantizationConfigSchema = z.union([
  z.literal("None"),
  z.object({ Scalar: ScalarQuantizationConfigSchema }),
]);

// ─── Tiered Storage ─────────────────────────────────────────────────────────

/**
 * Configuration for tiered storage.
 *
 * When enabled, points are automatically moved between storage tiers
 * (Hot/Warm/Cold) based on access frequency.
 */
export interface TieredStorageConfig {
  /** Enable tiered storage (default: false). */
  enabled: boolean;
  /** Points accessed within this many hours stay in Hot (RAM). Default: 24. */
  hot_threshold_hours?: number;
  /** Points accessed within this many hours stay in Warm (mmap). Default: 168 (7 days). */
  warm_threshold_hours?: number;
  /** Interval between automatic compaction runs (seconds). Default: 3600. */
  compaction_interval_secs?: number;
}

export const TieredStorageConfigSchema = z.object({
  enabled: z.boolean(),
  hot_threshold_hours: z.number().int().positive().optional(),
  warm_threshold_hours: z.number().int().positive().optional(),
  compaction_interval_secs: z.number().int().positive().optional(),
});

/**
 * Distribution of points across storage tiers.
 */
export interface TierDistribution {
  /** Number of points in the Hot tier (RAM). */
  hot: number;
  /** Number of points in the Warm tier (mmap). */
  warm: number;
  /** Number of points in the Cold tier (disk). */
  cold: number;
  /** Estimated memory usage for the Hot tier (bytes). */
  hot_memory_bytes: number;
  /** Estimated memory usage for the Warm tier (bytes). */
  warm_memory_bytes: number;
  /** Estimated memory usage for the Cold tier (bytes). */
  cold_memory_bytes: number;
}

export const TierDistributionSchema = z.object({
  hot: z.number().int(),
  warm: z.number().int(),
  cold: z.number().int(),
  hot_memory_bytes: z.number().int(),
  warm_memory_bytes: z.number().int(),
  cold_memory_bytes: z.number().int(),
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
  /** Vector quantization config. Use `{ Scalar: { dtype: "Int8" } }` for SQ8. */
  quantization?: QuantizationConfig;
  /** Tiered storage config. When enabled, points move automatically between Hot/Warm/Cold tiers. */
  tiered_storage?: TieredStorageConfig;
}

export const CollectionConfigSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/, {
    message: "name can only contain letters, numbers, hyphens, and underscores",
  }),
  dimension: z.number().int().min(1).max(4096),
  distance: DistanceMetricSchema,
  enable_bm25: z.boolean().optional(),
  bm25_text_field: z.string().min(1).optional(),
  quantization: QuantizationConfigSchema.optional(),
  tiered_storage: TieredStorageConfigSchema.optional(),
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
  distance: DistanceMetric;
}

export const CollectionListItemSchema = z.object({
  name: z.string(),
  dimension: z.number().int(),
  num_points: z.number().int(),
  created_at: z.number(),
  distance: DistanceMetricSchema,
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
  /** Restrict results to this logical namespace (multitenancy). */
  namespace?: string;
  /** Named vector field to search against (e.g. "title_vector", "content_vector"). Omit or "default" for main vector. */
  vector_field?: string;
}

export const SearchQuerySchema = z.object({
  vector: z.array(z.number()).min(1),
  limit: z.number().int().min(1),
  filter: z.record(z.unknown()).optional(),
  budget_ms: z.number().int().positive().optional(),
  namespace: z.string().optional(),
  vector_field: z.string().optional(),
});

// ─── Search Result ──────────────────────────────────────────────────────────

export interface SearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
  /** Present when the point was stored with a namespace. */
  namespace?: string;
}

export const SearchResultSchema = z.object({
  id: z.string(),
  score: z.number(),
  metadata: z.record(z.unknown()),
  namespace: z.string().optional(),
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
  query_id?: string;
}

export const SearchPointsResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  took_ms: z.number().int(),
  query_id: z.string().optional(),
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
  /** Restrict estimate to scenario filtered by this namespace. */
  namespace?: string;
}

export const EstimateSearchQuerySchema = z.object({
  limit: z.number().int().min(1),
  filter: z.record(z.unknown()).optional(),
  include_history: z.boolean().optional(),
  namespace: z.string().optional(),
});

// ─── Explain Query ──────────────────────────────────────────────────────

export interface ConditionResult {
  field: string;
  operator: string;
  expected?: unknown;
  actual?: unknown;
  passed: boolean;
}

export const ConditionResultSchema = z.object({
  field: z.string(),
  operator: z.string(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
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
  similarity?: number | null;
  score_breakdown: Record<string, number>;
  filter_evaluation?: FilterExplanation | null;
  rank_before_filter: number;
  rank_after_filter: number;
}

export const ExplainResultSchema = z.object({
  id: z.string(),
  score: z.number(),
  distance_metric: z.string(),
  raw_distance: z.number(),
  similarity: z.number().optional().nullable(),
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

// ─── Collection Detail (GET /collections/{name}) ────────────────────────────

export interface CollectionStats {
  index_size_bytes: number;
}

export const CollectionStatsSchema = z.object({
  index_size_bytes: z.number().int(),
});

export interface CollectionDetail {
  name: string;
  dimension: number;
  num_points: number;
  last_updated: number;
  distance: DistanceMetric;
  stats: CollectionStats;
}

export const CollectionDetailSchema = z.object({
  name: z.string(),
  dimension: z.number().int(),
  num_points: z.number().int(),
  last_updated: z.number(),
  distance: DistanceMetricSchema,
  stats: CollectionStatsSchema,
});

// ─── Point Detail (GET /collections/{name}/points/{id}) ─────────────────────

export interface PointDetail {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
  created_at: number;
  /** Present when the point was stored with a namespace. */
  namespace?: string;
  /** Named vectors (e.g. title_vector, content_vector) when present. */
  vectors?: Record<string, number[]>;
}

export const PointDetailSchema = z.object({
  id: z.string(),
  vector: z.array(z.number()),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.number(),
  namespace: z.string().optional(),
  vectors: z.record(z.string(), z.array(z.number())).optional(),
});

// ─── List Points (GET /collections/{name}/points) ───────────────────────────

export interface ListPointsResult {
  points: PointDetail[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export const ListPointsResultSchema = z.object({
  points: z.array(PointDetailSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  has_more: z.boolean(),
});

// ─── Delete Points Result ───────────────────────────────────────────────────

export interface DeletePointsResult {
  deleted: number;
}

export const DeletePointsResultSchema = z.object({
  deleted: z.number().int(),
});

// ─── Hybrid Search Query ────────────────────────────────────────────────────

export interface HybridSearchQuery {
  /** Text query for BM25 keyword matching. */
  query_text: string;
  /** Query vector for similarity search. */
  query_vector: number[];
  /** Maximum number of results. */
  limit: number;
  /** Weight for vector search score (0-1). BM25 weight = 1 - alpha. Default: 0.5. Used with fusion: "weighted". */
  alpha?: number;
  /** Fusion strategy: "weighted" (default) or "rrf" (Reciprocal Rank Fusion). */
  fusion?: "weighted" | "rrf";
  /** RRF constant k (default: 60). Only used when fusion is "rrf". Higher values smooth rank differences. */
  rrf_k?: number;
  /** Restrict results to this logical namespace (multitenancy). */
  namespace?: string;
}

export const HybridSearchQuerySchema = z.object({
  query_text: z.string().min(1),
  query_vector: z.array(z.number()).min(1),
  limit: z.number().int().min(1),
  alpha: z.number().min(0).max(1).optional(),
  fusion: z.enum(["weighted", "rrf"]).optional(),
  rrf_k: z.number().int().min(1).optional(),
  namespace: z.string().optional(),
});

// ─── Reindex ─────────────────────────────────────────────────────────────────

export enum ReindexStatus {
  Queued = "Queued",
  Building = "Building",
  Swapping = "Swapping",
  Completed = "Completed",
  Failed = "Failed",
}

const ReindexStatusSchema = z.nativeEnum(ReindexStatus);

export interface ReindexStats {
  points_processed: number;
  points_total: number;
  tombstones_cleaned: number;
  old_index_size_bytes: number;
  new_index_size_bytes: number;
}

export const ReindexStatsSchema = z.object({
  points_processed: z.number().int(),
  points_total: z.number().int(),
  tombstones_cleaned: z.number().int(),
  old_index_size_bytes: z.number().int(),
  new_index_size_bytes: z.number().int(),
});

export interface ReindexJob {
  id: string;
  collection: string;
  status: ReindexStatus;
  progress: number;
  started_at: number;
  completed_at?: number | null;
  error?: string | null;
  stats: ReindexStats;
}

export const ReindexJobSchema = z.object({
  id: z.string(),
  collection: z.string(),
  status: ReindexStatusSchema,
  progress: z.number(),
  started_at: z.number(),
  completed_at: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  stats: ReindexStatsSchema,
});

export interface StartReindexResponse {
  job_id: string;
  collection: string;
  status: ReindexStatus;
  message: string;
}

export const StartReindexResponseSchema = z.object({
  job_id: z.string(),
  collection: z.string(),
  status: ReindexStatusSchema,
  message: z.string(),
});

export interface ListReindexJobsResponse {
  jobs: ReindexJob[];
}

export const ListReindexJobsResponseSchema = z.object({
  jobs: z.array(ReindexJobSchema),
});

// ─── WebSocket Messages ─────────────────────────────────────────────────────

export interface WsAckMessage {
  upserted: number;
  failed: number;
  took_ms: number;
}

export const WsAckMessageSchema = z.object({
  type: z.literal("ack"),
  upserted: z.number().int(),
  failed: z.number().int(),
  took_ms: z.number(),
});

export interface WsEventMessage {
  collection: string;
  action: string;
  point_ids: string[];
  timestamp: number;
}

export const WsEventMessageSchema = z.object({
  type: z.literal("event"),
  collection: z.string(),
  action: z.string(),
  point_ids: z.array(z.string()),
  timestamp: z.number(),
});

export interface WsErrorMessage {
  message: string;
  code: number;
}

export const WsErrorMessageSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
  code: z.number().int(),
});

// ─── Realtime Client Options ────────────────────────────────────────────────

export interface RealtimeClientOptions {
  /** Base URL of the FerresDB server (e.g., "http://localhost:8080"). */
  baseUrl: string;
  /** API key for authentication (passed as ?token= query param). */
  apiKey?: string;
}

export const RealtimeClientOptionsSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).optional(),
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
