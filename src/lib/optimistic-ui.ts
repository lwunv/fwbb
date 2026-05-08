import { useState, useCallback, useEffect, useRef } from "react";
import { fireAction } from "./optimistic-action";

type ActionResult = { error?: string; success?: boolean } | void;
type FireOptions = {
  retry?: boolean;
  successMsg?: string;
  onSuccess?: () => void;
};

/**
 * useOptimisticState
 *
 * Maintains a local state synced with a server-side prop. Provides a `fire`
 * function performing optimistic updates with automatic rollback on action
 * failure.
 *
 * Concurrency note: rollback captures the value via the functional updater
 * (read INSIDE setLocal), so two overlapping fires roll back to the value
 * seen at fire-time, not a closure-bound snapshot. The most recent server
 * prop also wins via `useEffect` re-sync.
 */
export function useOptimisticState<T>(serverValue: T) {
  const [local, setLocal] = useState<T>(serverValue);
  const localRef = useRef<T>(serverValue);

  useEffect(() => {
    localRef.current = serverValue;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- optimistic local state must converge with server prop after revalidation.
    setLocal(serverValue);
  }, [serverValue]);

  const fire = useCallback(
    (
      optimisticValue: T,
      action: () => Promise<ActionResult>,
      options?: FireOptions,
    ) => {
      let prev: T;
      setLocal((current) => {
        prev = current;
        localRef.current = optimisticValue;
        return optimisticValue;
      });
      fireAction(
        action,
        () => {
          setLocal(prev);
          localRef.current = prev;
        },
        options,
      );
    },
    [],
  );

  return [local, fire, setLocal] as const;
}

/**
 * useOptimisticSet
 *
 * Manages a Set of IDs (membership flags). Functional updaters for both
 * apply + rollback so concurrent add/remove on different ids never collide.
 */
export function useOptimisticSet<T>(initialValues: T[] = []) {
  const [set, setSet] = useState<Set<T>>(() => new Set<T>(initialValues));

  const addOptimistically = useCallback(
    (id: T, action: () => Promise<ActionResult>, options?: FireOptions) => {
      let wasPresent = false;
      setSet((prev) => {
        wasPresent = prev.has(id);
        if (wasPresent) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      fireAction(
        action,
        () => {
          if (wasPresent) return;
          setSet((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        },
        options,
      );
    },
    [],
  );

  const removeOptimistically = useCallback(
    (id: T, action: () => Promise<ActionResult>, options?: FireOptions) => {
      let wasPresent = false;
      setSet((prev) => {
        wasPresent = prev.has(id);
        if (!wasPresent) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      fireAction(
        action,
        () => {
          if (!wasPresent) return;
          setSet((prev) => {
            if (prev.has(id)) return prev;
            const next = new Set(prev);
            next.add(id);
            return next;
          });
        },
        options,
      );
    },
    [],
  );

  return { set, addOptimistically, removeOptimistically, setSet };
}

/**
 * useOptimisticRecord
 *
 * Manages a key-value map. Captures the previous value of the SPECIFIC key
 * via functional updater so concurrent updates on different keys don't
 * stomp each other's rollback snapshots.
 */
export function useOptimisticRecord<K extends string | number, V>(
  initial: Record<K, V> = {} as Record<K, V>,
) {
  const [record, setRecord] = useState<Record<K, V>>(initial);

  const updateOptimistically = useCallback(
    (
      key: K,
      value: V,
      action: () => Promise<ActionResult>,
      options?: FireOptions,
    ) => {
      let prevValue: V | undefined;
      let hadKey = false;
      setRecord((prev) => {
        hadKey = key in prev;
        prevValue = prev[key];
        return { ...prev, [key]: value };
      });
      fireAction(
        action,
        () => {
          setRecord((prev) => {
            const next = { ...prev };
            if (!hadKey) {
              delete next[key];
            } else {
              next[key] = prevValue as V;
            }
            return next;
          });
        },
        options,
      );
    },
    [],
  );

  return { record, updateOptimistically, setRecord };
}

/**
 * useOptimisticList
 *
 * Adds / removes / patches items in a list. Re-syncs when `serverList`
 * changes (revalidation). All operations use functional updaters so
 * concurrent fires on different ids don't lose intermediate state.
 *
 * Constraint `T extends { id: ID }` — caller picks the id type via the
 * second generic param so we don't accidentally compare `1 !== "1"`.
 */
export function useOptimisticList<
  ID extends number | string,
  T extends { id: ID },
>(serverList: T[]) {
  const [local, setLocal] = useState<T[]>(serverList);

  useEffect(() => {
    setLocal(serverList);
  }, [serverList]);

  const addOptimistically = useCallback(
    (
      ghostItem: T,
      action: () => Promise<ActionResult>,
      options?: FireOptions,
    ) => {
      const ghostId = ghostItem.id;
      setLocal((current) => [ghostItem, ...current]);
      fireAction(
        action,
        () =>
          setLocal((current) =>
            current.some((i) => i.id === ghostId)
              ? current.filter((i) => i.id !== ghostId)
              : current,
          ),
        options,
      );
    },
    [],
  );

  const removeOptimistically = useCallback(
    (id: ID, action: () => Promise<ActionResult>, options?: FireOptions) => {
      let removed: T | undefined;
      let removedIndex = -1;
      setLocal((current) => {
        removedIndex = current.findIndex((item) => item.id === id);
        if (removedIndex < 0) return current;
        removed = current[removedIndex];
        return current.filter((item) => item.id !== id);
      });
      fireAction(
        action,
        () => {
          if (!removed || removedIndex < 0) return;
          setLocal((current) => {
            if (current.some((i) => i.id === id)) return current;
            const next = [...current];
            const insertAt = Math.min(removedIndex, next.length);
            next.splice(insertAt, 0, removed!);
            return next;
          });
        },
        options,
      );
    },
    [],
  );

  const updateOptimistically = useCallback(
    (
      id: ID,
      patch: Partial<T> | ((item: T) => T),
      action: () => Promise<ActionResult>,
      options?: FireOptions,
    ) => {
      let prevItem: T | undefined;
      setLocal((current) =>
        current.map((item) => {
          if (item.id !== id) return item;
          prevItem = item;
          return typeof patch === "function"
            ? patch(item)
            : { ...item, ...patch };
        }),
      );
      fireAction(
        action,
        () => {
          if (!prevItem) return;
          setLocal((current) =>
            current.map((item) => (item.id === id ? prevItem! : item)),
          );
        },
        options,
      );
    },
    [],
  );

  return {
    list: local,
    addOptimistically,
    removeOptimistically,
    updateOptimistically,
    setList: setLocal,
  };
}
