/**
 * comment-store-ops — CRUD operations for CommentRepository.
 *
 * Reads and mutations are split into separate base classes for clarity;
 * this file combines them for the CommentRepository facade.
 *
 * Source: b4a-architecture.md (Wave 3 modularity)
 */

import { CommentQueryOps } from "./comment-query-ops.js";
import { CommentMutationOps } from "./comment-mutation-ops.js";

// Re-export both base classes for consumers that need them directly.
export { CommentQueryOps } from "./comment-query-ops.js";
export { CommentMutationOps } from "./comment-mutation-ops.js";

/**
 * CommentRepository base class — combines query and mutation operations.
 * The facade pattern keeps the public API as a single class while
 * delegating to the separated read/write base classes.
 *
 * CommentMutationOps already extends CommentQueryOps, so extending it
 * gives both read and mutation methods in one class.
 */
export class CommentRepositoryOps extends CommentMutationOps {}
