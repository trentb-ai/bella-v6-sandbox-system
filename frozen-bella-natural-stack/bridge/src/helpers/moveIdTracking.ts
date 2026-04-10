// MoveIdTracker — write-through cache pattern
// CRITICAL: DO hibernation resets in-memory state. This class persists move IDs
// to DurableObject storage on every mutation so they survive hibernation.
//
// USAGE:
//   // At DO class level (not per-request):
//   private moveIdTracker = new MoveIdTracker();
//
//   // In WebSocket open handler (before any processing):
//   await this.moveIdTracker.load(this.state.storage);
//
//   // When a directive is confirmed delivered:
//   await this.moveIdTracker.track(this.state.storage, moveId);
//
//   // To check if a move was already spoken (synchronous — uses cache):
//   if (this.moveIdTracker.has(moveId)) { ... }

export class MoveIdTracker {
  private cache: string[] | null = null;

  async load(storage: DurableObjectStorage): Promise<void> {
    this.cache = (await storage.get<string[]>('spoken.moveIds')) ?? [];
  }

  async track(storage: DurableObjectStorage, moveId: string): Promise<void> {
    if (this.cache === null) await this.load(storage);
    if (!this.cache!.includes(moveId)) {
      this.cache!.push(moveId);
      await storage.put('spoken.moveIds', this.cache);
    }
  }

  has(moveId: string): boolean {
    // Synchronous read from cache — call load() first in WebSocket open handler
    return (this.cache ?? []).includes(moveId);
  }

  async getAll(storage: DurableObjectStorage): Promise<string[]> {
    if (this.cache === null) await this.load(storage);
    return [...this.cache!];
  }

  // Call if you need to force a re-read from storage (e.g. after suspected hibernation)
  invalidate(): void {
    this.cache = null;
  }
}
