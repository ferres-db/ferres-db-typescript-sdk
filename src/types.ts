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
}

export const CollectionConfigSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/, {
    message: "name can only contain letters, numbers, hyphens, and underscores",
  }),
  dimension: z.number().int().min(1).max(4096),
  distance: DistanceMetricSchema,
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
}

export const SearchQuerySchema = z.object({
  vector: z.array(z.number()).min(1),
  limit: z.number().int().min(1),
  filter: z.record(z.unknown()).optional(),
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

// ─── Client Options ─────────────────────────────────────────────────────────

export interface VectorDBClientOptions {
  baseUrl: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export const VectorDBClientOptionsSchema = z.object({
  baseUrl: z.string().url(),
  timeout: z.number().int().positive().optional().default(30000),
  maxRetries: z.number().int().min(0).optional().default(3),
  retryDelay: z.number().int().positive().optional().default(1000),
});
