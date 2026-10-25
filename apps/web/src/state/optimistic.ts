export interface OptimisticOptions<T> {
  successToast?: string;
  errorToast?: string;
  onSuccess?: (result: T) => void;
  addToast: (toast: { type: "info" | "success" | "warning" | "error"; message: string }) => void;
}

/**
 * Shared optimistic mutation framework:
 * 1. Synchronously updates state for instant UI response (checkboxes, grades, dismissals).
 * 2. Fires the asynchronous IPC / network command.
 * 3. On success, executes onSuccess and emits honest success toast (if configured).
 * 4. On failure, triggers rollback() to restore prior state and emits an honest error toast.
 */
export async function applyOptimistic<T>(
  optimisticUpdate: () => void,
  networkOperation: () => Promise<T>,
  rollback: () => void,
  options: OptimisticOptions<T>,
): Promise<T | null> {
  optimisticUpdate();

  try {
    const result = await networkOperation();
    if (options.onSuccess) {
      options.onSuccess(result);
    }
    if (options.successToast) {
      options.addToast({
        type: "success",
        message: options.successToast,
      });
    }
    return result;
  } catch (err) {
    rollback();
    const errorMessage =
      options.errorToast ||
      (err instanceof Error ? err.message : "Operation failed. Restored previous state.");
    options.addToast({
      type: "error",
      message: errorMessage,
    });
    return null;
  }
}
