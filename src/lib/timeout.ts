/**
 * Bounds a promise so a hung/never-resolving call (e.g. a stale dev-server
 * action manifest, a dropped network request) can never leave calling UI
 * stuck in a "busy" state forever with no way to recover.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}
