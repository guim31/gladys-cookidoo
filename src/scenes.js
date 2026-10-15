// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+): the shopping list
// from a scene — "Add milk" from a button, a voice command or a routine.
//
// Each handler receives the RESOLVED fields (scene variables substituted,
// validated by the core) and returns the declared outputs, so the next
// actions of the scene can say what happened. A failure throws: the core
// fails that action only, and the scene goes on.
//
// No scene trigger: the counts and the recipe of the day are device features,
// a scene condition reads them (state, not event).
// -----------------------------------------------------------------------------

export const SCENE_ACTION = {
  ADD: 'add_item',
  CHECK: 'check_item',
  UNCHECK: 'uncheck_item',
  CLEAR: 'clear_checked_items',
};

/** Items left to buy, for the outputs. */
export const remainingCount = (items) => items.filter((item) => !item.checked).length;
