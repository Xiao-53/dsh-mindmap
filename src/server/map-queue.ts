const queues = new Map<string, Promise<unknown>>()
export async function serializeMap<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(run)
  queues.set(key,pending)
  try { return await pending } finally { if(queues.get(key) === pending) queues.delete(key) }
}
