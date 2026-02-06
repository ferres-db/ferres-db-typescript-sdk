import axios, {
  AxiosInstance,
  AxiosError,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from "axios";
import {
  Collection,
  CollectionConfig,
  CollectionListItem,
  DistanceMetric,
  Point,
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
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  /**
   * Initialize the VectorDB client.
   *
   * @param options - Client configuration options
   */
  constructor(options: VectorDBClientOptions) {
    // Validate options
    const validatedOptions = VectorDBClientOptionsSchema.parse(options);

    this.maxRetries = validatedOptions.maxRetries ?? 3;
    this.retryDelay = validatedOptions.retryDelay ?? 1000;

    // Create axios instance
    this.axiosInstance = axios.create({
      baseURL: validatedOptions.baseUrl.replace(/\/$/, ""),
      timeout: validatedOptions.timeout ?? 30000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Setup request interceptor for logging
    this.axiosInstance.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        // Can add request logging here if needed
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
          const errorData = error.response.data as {
            error?: string;
            message?: string;
            code?: number;
          };

          const errorType = errorData.error || "unknown";
          const message = errorData.message || error.message || "Unknown error";
          const code = errorData.code || error.response.status;

          throw createErrorFromResponse(errorType, message, code);
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
            const errorData = error.response.data as {
              error?: string;
              message?: string;
              code?: number;
            };
            const errorType = errorData.error || "unknown";
            const message =
              errorData.message || error.message || "Unknown error";
            const code = errorData.code || error.response.status;
            throw createErrorFromResponse(errorType, message, code);
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
    const response = await this.request<Collection>(
      "POST",
      "/api/v1/collections",
      {
        name: config.name,
        dimension: config.dimension,
        distance: config.distance,
      },
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
   * @param query - Search query with vector, limit, and optional filter
   * @returns List of search results sorted by similarity
   */
  async search(
    collection: string,
    query: SearchQuery,
  ): Promise<SearchResult[]> {
    const response = await this.request<{
      results: SearchResult[];
      took_ms: number;
    }>("POST", `/api/v1/collections/${collection}/search`, {
      vector: query.vector,
      limit: query.limit,
      ...(query.filter && { filter: query.filter }),
    });

    const validated = SearchPointsResponseSchema.parse(response);
    return validated.results;
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
}
