import { useState, useCallback, useEffect } from "react";
import { fireAction } from "./optimistic-action";

type ActionResult = { error?: string; success?: boolean } | void;

/**
 * useOptimisticState
 *
 * A hook that maintains a local state synced with a server-side prop.
 * It provides a 'fire' function to perform optimistic updates with automatic rollback.
 */
export function useOptimisticState<T>(serverValue: T) {
  const [local, setLocal] = useState<T>(serverValue);

  // Sync with server when props change (revalidation)
  useEffect(() => {
    setLocal(serverValue);
  }, [serverValue]);

  const fire = useCallback(
    (
      optimisticValue: T,
      action: () => Promise<ActionResult>,
      options?: {
        retry?: boolean;
        successMsg?: string;
        onSuccess?: () => void;
      },
    ) => {
      const prev = local;
      setLocal(optimisticValue);
      fireAction(action, () => setLocal(prev), options);
    },
    [local],
  );

  return [local, fire, setLocal] as const;
}

/**
 * useOptimisticSet
 *
 * Specifically for managing sets of IDs (e.g., 'completingSessions', 'cancelledSessions').
 */
export function useOptimisticSet<T>(initialValues: T[] = []) {
  const [set, setSet] = useState(new Set<T>(initialValues));

  const addOptimistically = useCallback(
    (
      id: T,
      action: () => Promise<ActionResult>,
      options?: {
        retry?: boolean;
        successMsg?: string;
        onSuccess?: () => void;
      },
    ) => {
      setSet((prev) => new Set(prev).add(id));
      fireAction(
        action,
        () =>
          setSet((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          }),
        options,
      );
    },
    [],
  );

  const removeOptimistically = useCallback(
    (
      id: T,
      action: () => Promise<ActionResult>,
      options?: {
        retry?: boolean;
        successMsg?: string;
        onSuccess?: () => void;
      },
    ) => {
      setSet((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      fireAction(
        action,
        () => setSet((prev) => new Set(prev).add(id)),
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
 * For managing key-value optimistic states (e.g., { [sessionId]: { play: 1, dine: 2 } }).
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
      options?: {
        retry?: boolean;
        successMsg?: string;
        onSuccess?: () => void;
      },
    ) => {
      const prevValue = record[key];
      setRecord((prev) => ({ ...prev, [key]: value }));
      fireAction(
        action,
        () => {
          setRecord((prev) => {
            const next = { ...prev };
            if (prevValue === undefined) {
              delete next[key];
            } else {
              next[key] = prevValue;
            }
            return next;
          });
        },
        options,
      );
    },
    [record],
  );

  return { record, updateOptimistically, setRecord };
}

/**
 * Hook for managing an optimistic list (e.g. adding ghost items, patching existing ones).
 */
export function useOptimisticList<T extends { id: number | string }>(
  serverList: T[],
) {
  const [local, setLocal] = useState<T[]>(serverList);

  useEffect(() => {
    setLocal(serverList);
  }, [serverList]);

  const addOptimistically = useCallback(
    (
      ghostItem: T,
      action: () => Promise<ActionResult>,
      options?: {
        retry?: boolean;
        successMsg?: string;
        onSuccess?: () => void;
      },
    ) => {
      const prev = local;
      setLocal((current) => [ghostItem, ...current]);
      fireAction(action, () => setLocal(prev), options);
    },
    [local],
  );

  const removeOptimistically = useCallback(
    (
      id: number | string,
      action: () => Promise<ActionResult>,
      options?: {
        retry?: boolean;
        successMsg?: string;
        onSuccess?: () => void;
      },
    ) => {
      const prev = local;
      setLocal((current) => current.filter((item) => item.id !== id));
      fireAction(action, () => setLocal(prev), options);
    },
    [local],
  );

  const updateOptimistically = useCallback(
    (
      id: number | string,
      patch: Partial<T> | ((item: T) => T),
      action: () => Promise<ActionResult>,
      options?: {
        retry?: boolean;
        successMsg?: string;
        onSuccess?: () => void;
      },
    ) => {
      const prev = local;
      setLocal((current) =>
        current.map((item) => {
          if (item.id === id) {
            return typeof patch === "function"
              ? patch(item)
              : { ...item, ...patch };
          }
          return item;
        }),
      );
      fireAction(action, () => setLocal(prev), options);
    },
    [local],
  );

  return {
    list: local,
    addOptimistically,
    removeOptimistically,
    updateOptimistically,
    setList: setLocal,
  };
}
