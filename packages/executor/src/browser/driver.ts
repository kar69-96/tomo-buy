/**
 * The browser surface the Executor drives. Kept narrow on purpose: the Executor
 * fills fields with placeholder MARKERS only and runs the atomic swap. No method
 * returns or accepts a real secret except `evaluateSwap`, which hands the swap
 * map to in-page JS that lives for milliseconds — never to the Node side.
 */

/** A discovered form field. Carries identity only — never a value. */
export interface FieldDescriptor {
  /** A selector the driver can target (e.g. `[name="card_number"]`). */
  readonly selector: string;
  /** The field's `name` attribute, used to map to a PII/card placeholder. */
  readonly name: string;
}

export interface BrowserDriver {
  /** Navigate to a URL (live driver) — unused by the local-form path. */
  goto(url: string): Promise<void>;
  /** Load an HTML document directly (used to drive a local mock checkout form). */
  setContent(html: string): Promise<void>;
  /** List form fields by selector + name. Returns identity, never values. */
  discoverFields(): Promise<FieldDescriptor[]>;
  /** Put a placeholder MARKER (e.g. `{{card_number}}`) into a field. Never a secret. */
  fillField(selector: string, marker: string): Promise<void>;
  /**
   * Run the verbatim atomic-swap script in the page with the given swap map. The
   * real values exist only inside the page for the duration of this call.
   */
  evaluateSwap(scriptString: string, swapMap: Record<string, string>): Promise<void>;
  /** Read back a single field value (post-swap verification / confirmation read). */
  readValue(selector: string): Promise<string>;
  /** Visible page text — treated as DATA for instruction surfacing, never executed. */
  getPageText(): Promise<string>;
  /** Tear down the session. */
  close(): Promise<void>;
}
