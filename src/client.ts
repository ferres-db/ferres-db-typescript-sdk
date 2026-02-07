import axios, {
  AxiosInstance,
  AxiosError,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from "axios";
import { z } from "zod";
import {
  ApiKeyInfo,
  Collection,
  CollectionConfig,
  CollectionListItem,
  CreateKeyResponse,
  CreateKeyResponseSchema,
  ApiKeyInfoSchema,
  DistanceMetric,
  EstimateSearchQuery,
  EstimateSearchResponse,
  EstimateSearchResponseSchema,
  ExplainSearchQuery,
  Point,
  SearchExplanation,
  SearchExplanationSchema,
  SearchQuery,
  SearchResult,
  UpsertResult,
  VectorDBClientOptions,
  VectorDBClientOptionsSchema,
  CollectionSchema,
  ListCollectionsResponseSchema,
  UpsertResultSchema,
  SearchPointsResponseSchema,
} from "./types";
import {
  VectorDBError,
  InvalidPayloadError,
  ConnectionError,
  createErrorFromResponse,
} from "./errors";

/**
 * Maximum batch size for upsert operations.
 */
const MAX_BATCH_SIZE = 1000;

/**
 * Client for interacting with FerresDB vector database.
 */
export class VectorDBClient {
  private readonly axiosInstance: AxiosInstance;
  private readonly apiKey: string | undefined;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  /**
   * Initialize the VectorDB client.
   *
   * @param options - Client configuration options (apiKey required for protected routes)
   */
  constructor(options: VectorDBClientOptions) {
    // Validate options
    const validatedOptions = VectorDBClientOptionsSchema.parse(options);

    this.apiKey = validatedOptions.apiKey;
    this.maxRetries = validatedOptions.maxRetries ?? 3;
    this.retryDelay = validatedOptions.retryDelay ?? 1000;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    // Create axios instance
    this.axiosInstance = axios.create({
      baseURL: validatedOptions.baseUrl.replace(/\/$/, ""),
      timeout: validatedOptions.timeout ?? 30000,
      headers,
    });

    // Setup request interceptor (e.g. for logging; Authorization already set above)
    this.axiosInstance.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        return config;
      },
      (error) => {
        return Promise.reject(error);
      },
    );

    // Setup response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response) {
          // API returned an error response
          const errorData = error.response.data as Record<string, unknown>;

          const errorType = (errorData.error as string) || "unknown";
          const message =
            (errorData.message as string) || error.message || "Unknown error";
          const code =
            (errorData.code as number) || error.response.status;

          // Pass the full error body as extra context (e.g. for budget_exceeded estimate)
          throw createErrorFromResponse(errorType, message, code, errorData);
        } else if (error.request) {
          // Request was made but no response received
          throw new ConnectionError(`No response received: ${error.message}`);
        } else {
          // Something else happened
          throw new VectorDBError(`Request setup error: ${error.message}`);
        }
      },
    );
  }

  /**
   * Make an HTTP request with automatic retry and exponential backoff.
   */
  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const url = path.startsWith("/") ? path : `/${path}`;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.axiosInstance.request<T>({
          method,
          url,
          data,
          ...config,
        });

        return response.data;
      } catch (error) {
        // Don't retry client errors (4xx) - these are thrown by the interceptor
        if (error instanceof VectorDBError) {
          if (
            error.code !== undefined &&
            error.code >= 400 &&
            error.code < 500
          ) {
            throw error;
          }
          // If it's a server error (5xx), continue to retry logic below
        }

        // Retry server errors (5xx) and connection errors
        if (attempt < this.maxRetries) {
          const waitTime = this.retryDelay * Math.pow(2, attempt); // Exponential backoff
          await this.sleep(waitTime);
          continue;
        }

        // Max retries reached
        if (error instanceof VectorDBError) {
          throw error;
        }

        // Handle axios errors that weren't caught by interceptor
        if (axios.isAxiosError(error)) {
          if (error.response) {
            const errorData = error.response.data as Record<string, unknown>;
            const errorType = (errorData.error as string) || "unknown";
            const message =
              (errorData.message as string) || error.message || "Unknown error";
            const code =
              (errorData.code as number) || error.response.status;
            throw createErrorFromResponse(errorType, message, code, errorData);
          } else if (error.request) {
            throw new ConnectionError(`No response received: ${error.message}`);
          }
        }

        throw new ConnectionError(
          `Request failed after ${this.maxRetries + 1} attempts: ${error}`,
        );
      }
    }

    throw new ConnectionError(
      `Request failed after ${this.maxRetries + 1} attempts`,
    );
  }

  /**
   * Sleep for a given number of milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a new collection.
   *
   * @param config - Collection configuration
   * @returns Created collection
   */
  async createCollection(config: CollectionConfig): Promise<Collection> {
    const body: Record<string, unknown> = {
      name: config.name,
      dimension: config.dimension,
      distance: config.distance,
    };
    if (config.enable_bm25 !== undefined) {
      body.enable_bm25 = config.enable_bm25;
    }
    if (config.bm25_text_field !== undefined) {
      body.bm25_text_field = config.bm25_text_field;
    }
    const response = await this.request<Collection>(
      "POST",
      "/api/v1/collections",
      body,
    );

    return CollectionSchema.parse(response);
  }

  /**
   * List all collections.
   *
   * @returns List of collections
   */
  async listCollections(): Promise<Collection[]> {
    const response = await this.request<{ collections: CollectionListItem[] }>(
      "GET",
      "/api/v1/collections",
    );

    const validated = ListCollectionsResponseSchema.parse(response);

    // Convert CollectionListItem to Collection
    return validated.collections.map((item) => ({
      name: item.name,
      dimension: item.dimension,
      distance: DistanceMetric.Cosine, // API doesn't return distance in list, defaulting
      created_at: item.created_at,
    }));
  }

  /**
   * Delete a collection.
   *
   * @param name - Collection name
   */
  async deleteCollection(name: string): Promise<void> {
    await this.request("DELETE", `/api/v1/collections/${name}`);
  }

  /**
   * Upsert points into a collection.
   *
   * Automatically batches points if the list exceeds MAX_BATCH_SIZE (1000).
   *
   * @param collection - Collection name
   * @param points - List of points to upsert
   * @returns Upsert result with upserted count and failed points
   */
  async upsertPoints(
    collection: string,
    points: Point[],
  ): Promise<UpsertResult> {
    if (points.length === 0) {
      return { upserted: 0, failed: [] };
    }

    // Batch points if necessary
    if (points.length <= MAX_BATCH_SIZE) {
      return this.upsertBatch(collection, points);
    }

    // Split into batches
    let totalUpserted = 0;
    const allFailed: Array<{ id: string; reason: string }> = [];

    for (let i = 0; i < points.length; i += MAX_BATCH_SIZE) {
      const batch = points.slice(i, i + MAX_BATCH_SIZE);
      const result = await this.upsertBatch(collection, batch);
      totalUpserted += result.upserted;
      allFailed.push(...result.failed);
    }

    return { upserted: totalUpserted, failed: allFailed };
  }

  /**
   * Upsert a single batch of points.
   */
  private async upsertBatch(
    collection: string,
    points: Point[],
  ): Promise<UpsertResult> {
    const response = await this.request<UpsertResult>(
      "POST",
      `/api/v1/collections/${collection}/points`,
      {
        points: points.map((p) => ({
          id: p.id,
          vector: p.vector,
          metadata: p.metadata,
        })),
      },
    );

    return UpsertResultSchema.parse(response);
  }

  /**
   * Delete points from a collection by IDs.
   *
   * @param collection - Collection name
   * @param ids - List of point IDs to delete
   */
  async deletePoints(collection: string, ids: string[]): Promise<void> {
    if (ids.length === 0) {
      throw new InvalidPayloadError("ids cannot be empty");
    }

    await this.request("DELETE", `/api/v1/collections/${collection}/points`, {
      ids,
    });
  }

  /**
   * Search for similar vectors in a collection.
   *
   * @param collection - Collection name
   * @param query - Search query with vector, limit, optional filter, and optional budget_ms
   * @returns List of search results sorted by similarity
   * @throws {BudgetExceededError} If budget_ms is set and estimated cost exceeds it (HTTP 422)
   */
  async search(
    collection: string,
    query: SearchQuery,
  ): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      vector: query.vector,
      limit: query.limit,
      ...(query.filter && { filter: query.filter }),
      ...(query.budget_ms !== undefined && { budget_ms: query.budget_ms }),
    };

    const response = await this.request<{
      results: SearchResult[];
      took_ms: number;
    }>("POST", `/api/v1/collections/${collection}/search`, body);

    const validated = SearchPointsResponseSchema.parse(response);
    return validated.results;
  }

  /**
   * List API keys (requires valid API key with Editor/Admin role).
   *
   * @returns List of API key metadata (without raw key values)
   */
  async listKeys(): Promise<ApiKeyInfo[]> {
    const response = await this.request<ApiKeyInfo[]>("GET", "/api/v1/keys");
    return z.array(ApiKeyInfoSchema).parse(response);
  }

  /**
   * Create a new API key. The raw key is returned only once; store it securely.
   *
   * @param name - Display name for the key
   * @returns Created key info including the raw `key` (only time it is returned)
   */
  async createKey(name: string): Promise<CreateKeyResponse> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new InvalidPayloadError("name is required");
    }
    const response = await this.request<CreateKeyResponse>(
      "POST",
      "/api/v1/keys",
      {
        name: trimmed,
      },
    );
    return CreateKeyResponseSchema.parse(response);
  }

  /**
   * Delete an API key by id.
   *
   * @param id - Numeric id of the key (from listKeys or createKey)
   */
  async deleteKey(id: number): Promise<void> {
    await this.request("DELETE", `/api/v1/keys/${id}`);
  }

  // ─── Query Cost Estimation ────────────────────────────────────────────

  /**
   * Estimate the cost of a search query **before** executing it.
   *
   * Returns estimated latency, memory consumption, HNSW nodes visited,
   * whether the query is "expensive", and optimisation recommendations.
   *
   * @param collection - Collection name
   * @param query - Estimate query with limit, optional filter, and optional include_history
   * @returns Detailed cost estimate (and optional historical percentiles)
   * @throws {CollectionNotFoundError} If collection doesn't exist
   */
  async estimateSearchCost(
    collection: string,
    query: EstimateSearchQuery,
  ): Promise<EstimateSearchResponse> {
    const body: Record<string, unknown> = {
      limit: query.limit,
      ...(query.filter && { filter: query.filter }),
      ...(query.include_history !== undefined && {
        include_history: query.include_history,
      }),
    };

    const response = await this.request<EstimateSearchResponse>(
      "POST",
      `/api/v1/collections/${collection}/search/estimate`,
      body,
    );

    return EstimateSearchResponseSchema.parse(response);
  }

  // ─── Explain Query ────────────────────────────────────────────────────

  /**
   * Search with a detailed explanation of each result.
   *
   * Returns **why** each result was returned (or filtered): score breakdown,
   * per-condition filter evaluation, ranking before/after filters, and HNSW
   * index statistics.
   *
   * @param collection - Collection name
   * @param query - Explain query with vector, limit, and optional filter
   * @returns Full explanation per result
   * @throws {CollectionNotFoundError} If collection doesn't exist
   * @throws {InvalidDimensionError} If vector dimension doesn't match collection
   */
  async searchExplain(
    collection: string,
    query: ExplainSearchQuery,
  ): Promise<SearchExplanation> {
    const body: Record<string, unknown> = {
      vector: query.vector,
      limit: query.limit,
      ...(query.filter && { filter: query.filter }),
    };

    const response = await this.request<SearchExplanation>(
      "POST",
      `/api/v1/collections/${collection}/search/explain`,
      body,
    );

    return SearchExplanationSchema.parse(response);
  }
}

/**
 * Interface for VectorDBClient (for type checking).
 */
export interface IVectorDBClient {
  createCollection(config: CollectionConfig): Promise<Collection>;
  listCollections(): Promise<Collection[]>;
  deleteCollection(name: string): Promise<void>;
  upsertPoints(collection: string, points: Point[]): Promise<UpsertResult>;
  deletePoints(collection: string, ids: string[]): Promise<void>;
  search(collection: string, query: SearchQuery): Promise<SearchResult[]>;
  estimateSearchCost(
    collection: string,
    query: EstimateSearchQuery,
  ): Promise<EstimateSearchResponse>;
  searchExplain(
    collection: string,
    query: ExplainSearchQuery,
  ): Promise<SearchExplanation>;
  listKeys(): Promise<ApiKeyInfo[]>;
  createKey(name: string): Promise<CreateKeyResponse>;
  deleteKey(id: number): Promise<void>;
}
