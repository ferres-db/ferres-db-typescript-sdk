/**
 * Base error class for all VectorDB errors.
 */
export class VectorDBError extends Error {
  public readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "VectorDBError";
    this.code = code;
    Object.setPrototypeOf(this, VectorDBError.prototype);
  }
}

/**
 * Raised when a collection is not found.
 */
export class CollectionNotFoundError extends VectorDBError {
  constructor(collectionName: string) {
    super(`collection '${collectionName}' not found`, 404);
    this.name = "CollectionNotFoundError";
    Object.setPrototypeOf(this, CollectionNotFoundError.prototype);
  }
}

/**
 * Raised when trying to create a collection that already exists.
 */
export class CollectionAlreadyExistsError extends VectorDBError {
  constructor(collectionName: string) {
    super(`collection '${collectionName}' already exists`, 409);
    this.name = "CollectionAlreadyExistsError";
    Object.setPrototypeOf(this, CollectionAlreadyExistsError.prototype);
  }
}

/**
 * Raised when there's a dimension mismatch or invalid dimension.
 */
export class InvalidDimensionError extends VectorDBError {
  constructor(message: string) {
    super(message, 400);
    this.name = "InvalidDimensionError";
    Object.setPrototypeOf(this, InvalidDimensionError.prototype);
  }
}

/**
 * Raised when the request payload is invalid.
 */
export class InvalidPayloadError extends VectorDBError {
  constructor(message: string) {
    super(message, 400);
    this.name = "InvalidPayloadError";
    Object.setPrototypeOf(this, InvalidPayloadError.prototype);
  }
}

/**
 * Raised when an internal server error occurs.
 */
export class InternalError extends VectorDBError {
  constructor(message: string) {
    super(message, 500);
    this.name = "InternalError";
    Object.setPrototypeOf(this, InternalError.prototype);
  }
}

/**
 * Raised when estimated query cost exceeds the specified budget_ms (HTTP 422).
 * The `estimate` field contains the detailed cost estimate from the server.
 */
export class BudgetExceededError extends VectorDBError {
  public readonly estimate: Record<string, unknown>;

  constructor(message: string, estimate?: Record<string, unknown>) {
    super(message, 422);
    this.name = "BudgetExceededError";
    this.estimate = estimate ?? {};
    Object.setPrototypeOf(this, BudgetExceededError.prototype);
  }
}

/**
 * Raised when there's a connection error.
 */
export class ConnectionError extends VectorDBError {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
    Object.setPrototypeOf(this, ConnectionError.prototype);
  }
}

/**
 * Maps error type strings to error classes.
 */
const ERROR_MAP: Record<string, new (message: string) => VectorDBError> = {
  collection_not_found: CollectionNotFoundError,
  collection_already_exists: CollectionAlreadyExistsError,
  invalid_dimension: InvalidDimensionError,
  invalid_payload: InvalidPayloadError,
  internal_error: InternalError,
};

/**
 * Creates an appropriate error instance from an API error response.
 *
 * @param errorType - The error type string from the API response
 * @param message - Human-readable error message
 * @param _code - HTTP status code
 * @param extra - Additional fields from the error response body (e.g. `estimate`)
 */
export function createErrorFromResponse(
  errorType: string,
  message: string,
  _code?: number,
  extra?: Record<string, unknown>,
): VectorDBError {
  // Handle budget_exceeded specially (includes estimate in body)
  if (errorType === "budget_exceeded") {
    const estimate = (extra?.estimate ?? {}) as Record<string, unknown>;
    return new BudgetExceededError(message, estimate);
  }

  const ErrorClass = ERROR_MAP[errorType] || VectorDBError;

  // Special handling for collection errors that need the collection name
  if (
    errorType === "collection_not_found" &&
    message.includes("collection '")
  ) {
    const match = message.match(/collection '([^']+)'/);
    if (match) {
      return new CollectionNotFoundError(match[1]);
    }
  }

  if (
    errorType === "collection_already_exists" &&
    message.includes("collection '")
  ) {
    const match = message.match(/collection '([^']+)'/);
    if (match) {
      return new CollectionAlreadyExistsError(match[1]);
    }
  }

  return new ErrorClass(message);
}
