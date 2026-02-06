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
 */
export function createErrorFromResponse(
  errorType: string,
  message: string,
  _code?: number,
): VectorDBError {
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
