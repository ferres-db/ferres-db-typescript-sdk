import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { VectorDBClient } from "../src/client";
import {
  CollectionConfig,
  DistanceMetric,
  EstimateSearchQuery,
  ExplainSearchQuery,
  HybridSearchQuery,
  Point,
  ScalarType,
  SearchQuery,
} from "../src/types";
import {
  BudgetExceededError,
  CollectionNotFoundError,
  CollectionAlreadyExistsError,
  InvalidPayloadError,
} from "../src/errors";

// Mock axios
vi.mock("axios");
const mockedAxios = vi.mocked(axios);

describe("VectorDBClient", () => {
  let client: VectorDBClient;
  const baseUrl = "http://localhost:3000";

  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.create.mockReturnValue({
      request: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    } as any);

    client = new VectorDBClient({ baseUrl });
  });

  describe("constructor (apiKey)", () => {
    it("should set Authorization header when apiKey is provided", () => {
      const apiKey = "ferres_sk_abc123";
      mockedAxios.create.mockClear();
      new VectorDBClient({ baseUrl, apiKey });
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${apiKey}`,
          }),
        }),
      );
    });

    it("should not set Authorization header when apiKey is omitted", () => {
      mockedAxios.create.mockClear();
      new VectorDBClient({ baseUrl });
      const call = mockedAxios.create.mock.calls[0][0];
      expect(call.headers).not.toHaveProperty("Authorization");
    });
  });

  describe("createCollection", () => {
    it("should create a collection successfully", async () => {
      const config: CollectionConfig = {
        name: "test-collection",
        dimension: 384,
        distance: DistanceMetric.Cosine,
      };

      // Client's request() returns response.data (unwrapped body), not { data }
      const mockResponse = {
        name: "test-collection",
        dimension: 384,
        distance: DistanceMetric.Cosine,
        created_at: 1234567890,
      };

      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.createCollection(config);

      expect(result).toEqual({
        name: "test-collection",
        dimension: 384,
        distance: DistanceMetric.Cosine,
        created_at: 1234567890,
      });
      expect(mockRequest).toHaveBeenCalledWith("POST", "/api/v1/collections", {
        name: "test-collection",
        dimension: 384,
        distance: DistanceMetric.Cosine,
      });
    });

    it("should send enable_bm25 and bm25_text_field when provided", async () => {
      const config: CollectionConfig = {
        name: "docs",
        dimension: 384,
        distance: DistanceMetric.Cosine,
        enable_bm25: true,
        bm25_text_field: "content",
      };
      const mockResponse = {
        name: "docs",
        dimension: 384,
        distance: DistanceMetric.Cosine,
        created_at: 1234567890,
      };
      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      await client.createCollection(config);

      expect(mockRequest).toHaveBeenCalledWith("POST", "/api/v1/collections", {
        name: "docs",
        dimension: 384,
        distance: DistanceMetric.Cosine,
        enable_bm25: true,
        bm25_text_field: "content",
      });
    });
  });

  describe("listCollections", () => {
    it("should list collections successfully with distance", async () => {
      const mockResponse = {
        collections: [
          {
            name: "collection1",
            dimension: 384,
            num_points: 100,
            created_at: 1234567890,
            distance: "Cosine",
          },
          {
            name: "collection2",
            dimension: 768,
            num_points: 200,
            created_at: 1234567891,
            distance: "Euclidean",
          },
        ],
      };

      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.listCollections();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("collection1");
      expect(result[0].distance).toBe(DistanceMetric.Cosine);
      expect(result[1].name).toBe("collection2");
      expect(result[1].distance).toBe(DistanceMetric.Euclidean);
    });
  });

  describe("deleteCollection", () => {
    it("should delete a collection successfully", async () => {
      const mockRequest = vi.fn().mockResolvedValue(undefined);
      (client as any).request = mockRequest;

      await client.deleteCollection("test-collection");

      expect(mockRequest).toHaveBeenCalledWith(
        "DELETE",
        "/api/v1/collections/test-collection",
      );
    });
  });

  describe("upsertPoints", () => {
    it("should upsert points successfully", async () => {
      const points: Point[] = [
        {
          id: "point-1",
          vector: [0.1, 0.2, 0.3],
          metadata: { text: "test" },
        },
        {
          id: "point-2",
          vector: [0.4, 0.5, 0.6],
          metadata: { text: "test2" },
        },
      ];

      // upsertPoints uses upsertBatch; mock returns unwrapped body
      const mockRequest = vi.fn().mockResolvedValue(undefined);
      (client as any).request = mockRequest;
      (client as any).upsertBatch = vi.fn().mockResolvedValue({
        upserted: 2,
        failed: [],
      });

      const result = await client.upsertPoints("test-collection", points);

      expect(result.upserted).toBe(2);
      expect(result.failed).toHaveLength(0);
    });

    it("should handle empty points array", async () => {
      const result = await client.upsertPoints("test-collection", []);

      expect(result).toEqual({ upserted: 0, failed: [] });
    });
  });

  describe("deletePoints", () => {
    it("should delete points and return count", async () => {
      const mockRequest = vi.fn().mockResolvedValue({ deleted: 2 });
      (client as any).request = mockRequest;

      const result = await client.deletePoints("test-collection", [
        "id1",
        "id2",
      ]);

      expect(result.deleted).toBe(2);
      expect(mockRequest).toHaveBeenCalledWith(
        "DELETE",
        "/api/v1/collections/test-collection/points",
        { ids: ["id1", "id2"] },
      );
    });

    it("should throw error for empty ids", async () => {
      await expect(client.deletePoints("test-collection", [])).rejects.toThrow(
        InvalidPayloadError,
      );
    });
  });

  describe("search", () => {
    it("should search and return full response with query_id", async () => {
      const query: SearchQuery = {
        vector: [0.1, 0.2, 0.3],
        limit: 10,
      };

      const mockResponse = {
        results: [
          {
            id: "point-1",
            score: 0.95,
            metadata: { text: "test" },
          },
        ],
        took_ms: 5,
        query_id: "qid-123",
      };

      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.search("test-collection", query);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].id).toBe("point-1");
      expect(result.results[0].score).toBe(0.95);
      expect(result.took_ms).toBe(5);
      expect(result.query_id).toBe("qid-123");
    });

    it("should include filter in search query", async () => {
      const query: SearchQuery = {
        vector: [0.1, 0.2, 0.3],
        limit: 10,
        filter: { category: "test" },
      };

      const mockResponse = {
        results: [],
        took_ms: 2,
      };

      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      await client.search("test-collection", query);

      expect(mockRequest).toHaveBeenCalledWith(
        "POST",
        "/api/v1/collections/test-collection/search",
        {
          vector: [0.1, 0.2, 0.3],
          limit: 10,
          filter: { category: "test" },
        },
      );
    });
  });

  describe("listKeys", () => {
    it("should list API keys successfully", async () => {
      const mockResponse = [
        { id: 1, name: "key1", key_prefix: "ferres_sk_ab", created_at: 1000 },
        { id: 2, name: "key2", key_prefix: "ferres_sk_cd", created_at: 2000 },
      ];
      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.listKeys();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 1,
        name: "key1",
        key_prefix: "ferres_sk_ab",
        created_at: 1000,
      });
      expect(result[1]).toEqual({
        id: 2,
        name: "key2",
        key_prefix: "ferres_sk_cd",
        created_at: 2000,
      });
      expect(mockRequest).toHaveBeenCalledWith("GET", "/api/v1/keys");
    });
  });

  describe("createKey", () => {
    it("should create an API key and return raw key", async () => {
      const mockResponse = {
        id: 1,
        name: "my-key",
        key: "ferres_sk_raw_value_once",
        key_prefix: "ferres_sk_ra",
        created_at: 1234567890,
      };
      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.createKey("my-key");

      expect(result).toEqual(mockResponse);
      expect(mockRequest).toHaveBeenCalledWith("POST", "/api/v1/keys", {
        name: "my-key",
      });
    });

    it("should trim key name", async () => {
      const mockRequest = vi.fn().mockResolvedValue({
        id: 1,
        name: "trimmed",
        key: "ferres_sk_x",
        key_prefix: "ferres_sk_",
        created_at: 0,
      });
      (client as any).request = mockRequest;

      await client.createKey("  trimmed  ");

      expect(mockRequest).toHaveBeenCalledWith("POST", "/api/v1/keys", {
        name: "trimmed",
      });
    });

    it("should throw InvalidPayloadError for empty name", async () => {
      await expect(client.createKey("")).rejects.toThrow(InvalidPayloadError);
      await expect(client.createKey("   ")).rejects.toThrow(
        InvalidPayloadError,
      );
    });
  });

  describe("deleteKey", () => {
    it("should delete an API key by id", async () => {
      const mockRequest = vi.fn().mockResolvedValue(undefined);
      (client as any).request = mockRequest;

      await client.deleteKey(42);

      expect(mockRequest).toHaveBeenCalledWith("DELETE", "/api/v1/keys/42");
    });
  });

  // ─── Search with budget_ms ────────────────────────────────────────────

  describe("search with budget_ms", () => {
    it("should send budget_ms when provided", async () => {
      const query: SearchQuery = {
        vector: [0.1, 0.2, 0.3],
        limit: 10,
        budget_ms: 50,
      };

      const mockResponse = {
        results: [{ id: "point-1", score: 0.95, metadata: { text: "test" } }],
        took_ms: 3,
      };

      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.search("test-collection", query);

      expect(result.results).toHaveLength(1);
      expect(mockRequest).toHaveBeenCalledWith(
        "POST",
        "/api/v1/collections/test-collection/search",
        expect.objectContaining({ budget_ms: 50 }),
      );
    });

    it("should not send budget_ms when omitted", async () => {
      const query: SearchQuery = {
        vector: [0.1, 0.2, 0.3],
        limit: 10,
      };

      const mockResponse = { results: [], took_ms: 1 };
      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      await client.search("test-collection", query);

      const callBody = mockRequest.mock.calls[0][2];
      expect(callBody).not.toHaveProperty("budget_ms");
    });
  });

  // ─── Estimate Search Cost ─────────────────────────────────────────────

  describe("estimateSearchCost", () => {
    it("should return a valid cost estimate", async () => {
      const query: EstimateSearchQuery = { limit: 10 };

      const mockResponse = {
        estimated_ms: 2.35,
        confidence_range: [1.17, 8.0],
        estimated_memory_bytes: 45320,
        estimated_nodes_visited: 575,
        is_expensive: false,
        recommendations: [],
        breakdown: {
          index_scan_cost: 1.76,
          filter_cost: 0.0003,
          hydration_cost: 0.01,
          network_overhead: 0.1,
        },
      };

      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.estimateSearchCost("docs", query);

      expect(result.estimated_ms).toBe(2.35);
      expect(result.is_expensive).toBe(false);
      expect(result.estimated_nodes_visited).toBe(575);
      expect(result.breakdown.index_scan_cost).toBe(1.76);
      expect(result.historical_latency).toBeUndefined();
      expect(mockRequest).toHaveBeenCalledWith(
        "POST",
        "/api/v1/collections/docs/search/estimate",
        { limit: 10 },
      );
    });

    it("should send filter and include_history when provided", async () => {
      const query: EstimateSearchQuery = {
        limit: 100,
        filter: { category: "tech" },
        include_history: true,
      };

      const mockResponse = {
        estimated_ms: 5.0,
        confidence_range: [2.5, 15.0],
        estimated_memory_bytes: 90000,
        estimated_nodes_visited: 1000,
        is_expensive: true,
        recommendations: ["Reduza limit"],
        breakdown: {
          index_scan_cost: 3.5,
          filter_cost: 0.5,
          hydration_cost: 0.5,
          network_overhead: 0.5,
        },
        historical_latency: {
          p50_ms: 2.0,
          p95_ms: 8.0,
          p99_ms: 15.0,
          avg_ms: 3.2,
          total_queries: 1520,
        },
      };

      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.estimateSearchCost("docs", query);

      expect(result.is_expensive).toBe(true);
      expect(result.recommendations).toHaveLength(1);
      expect(result.historical_latency).toBeDefined();
      expect(result.historical_latency!.p50_ms).toBe(2.0);
      expect(result.historical_latency!.total_queries).toBe(1520);

      expect(mockRequest).toHaveBeenCalledWith(
        "POST",
        "/api/v1/collections/docs/search/estimate",
        { limit: 100, filter: { category: "tech" }, include_history: true },
      );
    });
  });

  // ─── Explain Search ───────────────────────────────────────────────────

  describe("searchExplain", () => {
    it("should return a valid explanation", async () => {
      const query: ExplainSearchQuery = {
        vector: [0.1, 0.2, -0.1],
        limit: 5,
      };

      const mockResponse = {
        query_vector_norm: 0.245,
        distance_metric: "Cosine",
        candidates_scanned: 30,
        candidates_after_filter: 5,
        results: [
          {
            id: "doc-1",
            score: 0.12,
            distance_metric: "Cosine",
            raw_distance: 0.12,
            score_breakdown: { vector_score: 0.12 },
            filter_evaluation: null,
            rank_before_filter: 1,
            rank_after_filter: 1,
          },
        ],
        index_stats: {
          total_points: 1000,
          hnsw_layers: 16,
          ef_search_used: 50,
          tombstones_skipped: 0,
        },
      };

      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.searchExplain("docs", query);

      expect(result.query_vector_norm).toBe(0.245);
      expect(result.distance_metric).toBe("Cosine");
      expect(result.candidates_scanned).toBe(30);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].id).toBe("doc-1");
      expect(result.results[0].score_breakdown.vector_score).toBe(0.12);
      expect(result.index_stats.total_points).toBe(1000);
      expect(result.index_stats.ef_search_used).toBe(50);

      expect(mockRequest).toHaveBeenCalledWith(
        "POST",
        "/api/v1/collections/docs/search/explain",
        { vector: [0.1, 0.2, -0.1], limit: 5 },
      );
    });

    it("should return per-condition filter evaluation", async () => {
      const query: ExplainSearchQuery = {
        vector: [0.1, 0.2, -0.1],
        limit: 10,
        filter: { category: "tech", price: { $gte: 10 } },
      };

      const mockResponse = {
        query_vector_norm: 0.3,
        distance_metric: "Cosine",
        candidates_scanned: 50,
        candidates_after_filter: 3,
        results: [
          {
            id: "doc-1",
            score: 0.85,
            distance_metric: "Cosine",
            raw_distance: 0.85,
            score_breakdown: { vector_score: 0.85 },
            filter_evaluation: {
              conditions: [
                {
                  field: "category",
                  operator: "$eq",
                  expected: "tech",
                  actual: "tech",
                  passed: true,
                },
                {
                  field: "price",
                  operator: "$gte",
                  expected: 10,
                  actual: 25,
                  passed: true,
                },
              ],
              passed: true,
            },
            rank_before_filter: 1,
            rank_after_filter: 1,
          },
        ],
        index_stats: {
          total_points: 5000,
          hnsw_layers: 20,
          ef_search_used: 100,
          tombstones_skipped: 3,
        },
      };

      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.searchExplain("products", query);

      expect(result.candidates_after_filter).toBe(3);
      const r = result.results[0];
      expect(r.filter_evaluation).toBeDefined();
      expect(r.filter_evaluation!.passed).toBe(true);
      expect(r.filter_evaluation!.conditions).toHaveLength(2);
      expect(r.filter_evaluation!.conditions[0].field).toBe("category");
      expect(r.filter_evaluation!.conditions[1].operator).toBe("$gte");
      expect(result.index_stats.tombstones_skipped).toBe(3);

      expect(mockRequest).toHaveBeenCalledWith(
        "POST",
        "/api/v1/collections/products/search/explain",
        {
          vector: [0.1, 0.2, -0.1],
          limit: 10,
          filter: { category: "tech", price: { $gte: 10 } },
        },
      );
    });
  });

  // ─── Create Collection with Quantization ─────────────────────────────

  describe("createCollection with quantization", () => {
    it("should send quantization config when provided", async () => {
      const config: CollectionConfig = {
        name: "quantized",
        dimension: 384,
        distance: DistanceMetric.Cosine,
        quantization: {
          Scalar: {
            dtype: ScalarType.Int8,
            always_ram: true,
            quantile: 95.0,
          },
        },
      };
      const mockResponse = {
        name: "quantized",
        dimension: 384,
        distance: DistanceMetric.Cosine,
        created_at: 1234567890,
      };
      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      await client.createCollection(config);

      expect(mockRequest).toHaveBeenCalledWith("POST", "/api/v1/collections", {
        name: "quantized",
        dimension: 384,
        distance: DistanceMetric.Cosine,
        quantization: {
          Scalar: { dtype: "Int8", always_ram: true, quantile: 95.0 },
        },
      });
    });

    it("should not send quantization when omitted", async () => {
      const config: CollectionConfig = {
        name: "plain",
        dimension: 128,
        distance: DistanceMetric.Euclidean,
      };
      const mockResponse = {
        name: "plain",
        dimension: 128,
        distance: DistanceMetric.Euclidean,
        created_at: 1234567890,
      };
      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      await client.createCollection(config);

      const callBody = mockRequest.mock.calls[0][2];
      expect(callBody).not.toHaveProperty("quantization");
    });
  });

  // ─── Get Collection ──────────────────────────────────────────────────

  describe("getCollection", () => {
    it("should get collection details", async () => {
      const mockResponse = {
        name: "my-col",
        dimension: 128,
        num_points: 5000,
        last_updated: 1700000000,
        distance: "Cosine",
        stats: { index_size_bytes: 1048576 },
      };
      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.getCollection("my-col");

      expect(result.name).toBe("my-col");
      expect(result.num_points).toBe(5000);
      expect(result.distance).toBe(DistanceMetric.Cosine);
      expect(result.stats.index_size_bytes).toBe(1048576);
      expect(mockRequest).toHaveBeenCalledWith(
        "GET",
        "/api/v1/collections/my-col",
      );
    });
  });

  // ─── Get Point ───────────────────────────────────────────────────────

  describe("getPoint", () => {
    it("should get a single point by ID", async () => {
      const mockResponse = {
        id: "doc-42",
        vector: [0.1, 0.2, 0.3],
        metadata: { text: "hello" },
        created_at: 1700000000,
      };
      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.getPoint("my-col", "doc-42");

      expect(result.id).toBe("doc-42");
      expect(result.vector).toEqual([0.1, 0.2, 0.3]);
      expect(result.created_at).toBe(1700000000);
      expect(mockRequest).toHaveBeenCalledWith(
        "GET",
        "/api/v1/collections/my-col/points/doc-42",
      );
    });
  });

  // ─── List Points ─────────────────────────────────────────────────────

  describe("listPoints", () => {
    it("should list points with pagination", async () => {
      const mockResponse = {
        points: [
          { id: "p1", vector: [0.1], metadata: {}, created_at: 1000 },
          { id: "p2", vector: [0.2], metadata: {}, created_at: 2000 },
        ],
        total: 50,
        limit: 2,
        offset: 0,
        has_more: true,
      };
      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.listPoints("my-col", {
        limit: 2,
        offset: 0,
      });

      expect(result.points).toHaveLength(2);
      expect(result.total).toBe(50);
      expect(result.has_more).toBe(true);

      const calledPath = mockRequest.mock.calls[0][1];
      expect(calledPath).toContain("limit=2");
      expect(calledPath).toContain("offset=0");
    });

    it("should call without query params when no options", async () => {
      const mockResponse = {
        points: [],
        total: 0,
        limit: 100,
        offset: 0,
        has_more: false,
      };
      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      await client.listPoints("my-col");

      const calledPath = mockRequest.mock.calls[0][1];
      expect(calledPath).toBe("/api/v1/collections/my-col/points");
    });
  });

  // ─── Hybrid Search ───────────────────────────────────────────────────

  describe("hybridSearch", () => {
    it("should send hybrid search request", async () => {
      const query: HybridSearchQuery = {
        query_text: "hello world",
        query_vector: [0.1, 0.2, 0.3],
        limit: 5,
        alpha: 0.7,
      };
      const mockResponse = {
        results: [{ id: "doc-1", score: 0.92, metadata: { text: "hello" } }],
        took_ms: 8,
        query_id: "q-abc",
      };
      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.hybridSearch("docs", query);

      expect(result.results).toHaveLength(1);
      expect(result.took_ms).toBe(8);
      expect(result.query_id).toBe("q-abc");
      expect(mockRequest).toHaveBeenCalledWith(
        "POST",
        "/api/v1/collections/docs/search/hybrid",
        {
          query_text: "hello world",
          query_vector: [0.1, 0.2, 0.3],
          limit: 5,
          alpha: 0.7,
        },
      );
    });

    it("should omit alpha when not provided", async () => {
      const query: HybridSearchQuery = {
        query_text: "test",
        query_vector: [0.1],
        limit: 10,
      };
      const mockResponse = { results: [], took_ms: 1 };
      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      await client.hybridSearch("docs", query);

      const callBody = mockRequest.mock.calls[0][2];
      expect(callBody).not.toHaveProperty("alpha");
    });
  });
});
