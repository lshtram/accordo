/**
 * FileActivityTracker
 *
 * Advisory conflict detection for concurrent file editing.
 * When multiple sessions attempt to edit the same file, warnings are returned
 * but calls are NOT blocked (last-writer-wins).
 *
 * Requirements: multi-session-architecture.md §3.3 (MS-04)
 */

/**
 * Result of trackEdit — warning if another session is already editing.
 */
export interface TrackEditResult {
  warning: string;
}

/**
 * Active edit record.
 */
export interface ActiveEdit {
  sessionId: string;
  agentHint: string;
}

/**
 * Tracks in-progress file edits per session.
 * Provides advisory conflict detection for concurrent edit warnings.
 */
export class FileActivityTracker {
  private readonly activeEdits = new Map<string, ActiveEdit>();

  /**
   * Record that a session is editing a URI.
   * Returns a warning if another session is already editing this URI.
   * Does NOT block — caller must handle the warning.
   */
  trackEdit(
    sessionId: string,
    agentHint: string,
    uri: string,
  ): TrackEditResult | undefined {
    const existing = this.activeEdits.get(uri);

    // Check for conflict with a different session
    if (existing && existing.sessionId !== sessionId) {
      // Return warning but still record the new edit (last-writer-wins)
      const warning: TrackEditResult = {
        warning: `File "${uri}" is being edited by session ${existing.sessionId} (${existing.agentHint}). Proceeding with overwrite.`,
      };
      this.activeEdits.set(uri, { sessionId, agentHint });
      return warning;
    }

    // Same session or no existing edit — just record (idempotent update)
    this.activeEdits.set(uri, { sessionId, agentHint });
    return undefined;
  }

  /**
   * Get the active edit on a URI, if any.
   */
  getActiveEdit(uri: string): ActiveEdit | undefined {
    return this.activeEdits.get(uri);
  }

  /**
   * Release the edit lock on a URI.
   */
  releaseEdit(uri: string): void {
    this.activeEdits.delete(uri);
  }
}
