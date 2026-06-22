// TaskIntent + CartSpec are schema-derived (validated at the intent boundary
// before any side effect). Re-exported here for a single import site.
export type { CartItem, CartSpec, TaskIntent } from '../schemas/intent.js';
