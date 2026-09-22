// Small deterministic hook lifecycle harness. Complements, not replaces, browser QA.
module.exports = function hookHarness() {
  const slots = []; let cursor = 0, effects = [], hook, args, result;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (next) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }];
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!equal(slots[index]?.deps, deps)) slots[index] = { deps, callback };
      return slots[index].callback;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!equal(slots[index]?.deps, deps)) effects.push(() => {
        slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: effect() };
      });
    },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
  };
  const render = (...next) => {
    if (next.length) args = next;
    cursor = 0; effects = []; result = hook(...args); effects.forEach((effect) => effect()); return result;
  };
  return { react, mount(fn, ...values) { hook = fn; return render(...values); }, render,
    async settle() { for (let i = 0; i < 4; i++) { await new Promise(setImmediate); render(); } return result; },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
};
