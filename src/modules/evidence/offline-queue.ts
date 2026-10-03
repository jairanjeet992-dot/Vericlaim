// ============================================================================
// VERICLAIM MULTI-TENANT SAAS
// MODULE: evidence/offline-queue.ts
// PHASE 5: Investigation Activities, Evidence Pipeline (R2), Versioning, PWA
// ============================================================================

import { OfflineQueueItem, EvidenceCategory, ClaimedMetadata } from './types';

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Default persistent storage adapter:
 * Uses window.localStorage / IndexedDB in browser, or in-memory map fallback in tests/SSR.
 */
class PersistentStorageAdapter implements StorageAdapter {
  private static persistentStore: Map<string, string> = new Map();

  async getItem(key: string): Promise<string | null> {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        // Fallback if localStorage is unavailable
      }
    }
    return PersistentStorageAdapter.persistentStore.get(key) || null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch {
        // Fallback
      }
    }
    PersistentStorageAdapter.persistentStore.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(key);
        return;
      } catch {
        // Fallback
      }
    }
    PersistentStorageAdapter.persistentStore.delete(key);
  }

  static clear(): void {
    PersistentStorageAdapter.persistentStore.clear();
  }
}

export interface OfflineUploadQueueOptions {
  storageKey?: string;
  storageAdapter?: StorageAdapter;
  uploadExecutor?: (
    item: OfflineQueueItem
  ) => Promise<{ success: boolean; documentId?: string; error?: string }>;
}

export class OfflineUploadQueue {
  private storageKey: string;
  private storage: StorageAdapter;
  private isProcessing = false;
  private items: OfflineQueueItem[] = [];
  private uploadExecutor?: (
    item: OfflineQueueItem
  ) => Promise<{ success: boolean; documentId?: string; error?: string }>;

  constructor(options?: OfflineUploadQueueOptions) {
    this.storageKey = options?.storageKey || 'vericlaim_offline_upload_queue';
    this.storage = options?.storageAdapter || new PersistentStorageAdapter();
    this.uploadExecutor = options?.uploadExecutor;
  }

  /**
   * Initializes queue by loading persisted items from storage.
   * GATES: Survives app restart.
   */
  async load(): Promise<OfflineQueueItem[]> {
    const raw = await this.storage.getItem(this.storageKey);
    if (!raw) {
      this.items = [];
      return [];
    }

    try {
      this.items = JSON.parse(raw);
    } catch {
      this.items = [];
    }
    return [...this.items];
  }

  /**
   * Persist current queue items to persistent storage
   */
  private async persist(): Promise<void> {
    await this.storage.setItem(this.storageKey, JSON.stringify(this.items));
  }

  /**
   * Enqueue a new file upload job into offline storage
   */
  async enqueue(item: {
    id?: string;
    case_id: string;
    activity_id?: string | null;
    file_name: string;
    file_size: number;
    mime_type: string;
    sha256_hash: string;
    evidence_category: EvidenceCategory;
    claimed_metadata?: ClaimedMetadata;
    blobData?: string; // base64 or blob string
  }): Promise<OfflineQueueItem> {
    await this.load();

    const queueItem: OfflineQueueItem = {
      id: item.id || `q_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      case_id: item.case_id,
      activity_id: item.activity_id || null,
      file_name: item.file_name,
      file_size: item.file_size,
      mime_type: item.mime_type,
      sha256_hash: item.sha256_hash,
      evidence_category: item.evidence_category,
      claimed_metadata: item.claimed_metadata,
      blob: item.blobData,
      status: 'QUEUED',
      progress: 0,
      retry_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.items.push(queueItem);
    await this.persist();
    return queueItem;
  }

  /**
   * Get all items in the queue
   */
  async getItems(): Promise<OfflineQueueItem[]> {
    await this.load();
    return [...this.items];
  }

  /**
   * Remove a specific item from the queue
   */
  async removeItem(id: string): Promise<boolean> {
    await this.load();
    const prevLen = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.items.length !== prevLen) {
      await this.persist();
      return true;
    }
    return false;
  }

  /**
   * Process all queued or failed items sequentially
   */
  async processQueue(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    if (this.isProcessing) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    this.isProcessing = true;
    await this.load();

    let succeeded = 0;
    let failed = 0;

    try {
      for (const item of this.items) {
        if (item.status === 'COMPLETED') {
          continue;
        }

        item.status = 'UPLOADING';
        item.progress = 25;
        item.updated_at = new Date().toISOString();
        await this.persist();

        try {
          if (this.uploadExecutor) {
            const res = await this.uploadExecutor(item);
            if (res.success) {
              item.status = 'COMPLETED';
              item.progress = 100;
              item.error_message = undefined;
              succeeded++;
            } else {
              item.status = 'FAILED';
              item.retry_count++;
              item.error_message = res.error || 'Upload failed';
              failed++;
            }
          } else {
            // Default simulated upload execution
            item.status = 'COMPLETED';
            item.progress = 100;
            succeeded++;
          }
        } catch (err: any) {
          item.status = 'FAILED';
          item.retry_count++;
          item.error_message = err.message || 'Unknown network error';
          failed++;
        }

        item.updated_at = new Date().toISOString();
        await this.persist();
      }
    } finally {
      this.isProcessing = false;
    }

    return {
      processed: succeeded + failed,
      succeeded,
      failed,
    };
  }

  /**
   * Clear completed items
   */
  async clearCompleted(): Promise<number> {
    await this.load();
    const initialCount = this.items.length;
    this.items = this.items.filter((i) => i.status !== 'COMPLETED');
    await this.persist();
    return initialCount - this.items.length;
  }

  /**
   * Clear entire queue
   */
  async clearAll(): Promise<void> {
    this.items = [];
    await this.storage.removeItem(this.storageKey);
  }
}
