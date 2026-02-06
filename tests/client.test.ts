import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { VectorDBClient } from "../src/client";
import {
  CollectionConfig,
  DistanceMetric,
  Point,
  SearchQuery,
} from "../src/types";
import {
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
  });

  describe("listCollections", () => {
    it("should list collections successfully", async () => {
      // Client's request() returns unwrapped response body
      const mockResponse = {
        collections: [
          {
            name: "collection1",
            dimension: 384,
            num_points: 100,
            created_at: 1234567890,
          },
          {
            name: "collection2",
            dimension: 768,
            num_points: 200,
            created_at: 1234567891,
          },
        ],
      };

      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.listCollections();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("collection1");
      expect(result[1].name).toBe("collection2");
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
    it("should delete points successfully", async () => {
      const mockRequest = vi.fn().mockResolvedValue(undefined);
      (client as any).request = mockRequest;

      await client.deletePoints("test-collection", ["id1", "id2"]);

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
    it("should search successfully", async () => {
      const query: SearchQuery = {
        vector: [0.1, 0.2, 0.3],
        limit: 10,
      };

      // Client's request() returns unwrapped response body
      const mockResponse = {
        results: [
          {
            id: "point-1",
            score: 0.95,
            metadata: { text: "test" },
          },
        ],
        took_ms: 5,
      };

      const mockRequest = vi.fn().mockResolvedValue(mockResponse);
      (client as any).request = mockRequest;

      const result = await client.search("test-collection", query);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("point-1");
      expect(result[0].score).toBe(0.95);
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
});
