import path from 'node:path';
import {
  acquireFileLock,
  readJsonFile,
  writeJsonFile,
} from '../utils/files.js';
import { ensureDir } from '../utils/platform.js';
import type { Logger } from '../logging/logger.js';

export type RecordStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

export interface WorkflowRecordState {
  id: string;
  status: RecordStatus;
  profileName?: string;
  accountId?: string;
  currentStep?: string;
  error?: string;
  screenshot?: string;
  url?: string;
  retries?: number;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
}

export interface StateFile {
  records: Record<string, WorkflowRecordState>;
  version: number;
}

export class StateManager {
  private readonly statePath: string;
  private readonly lockPath: string;
  private readonly logger?: Logger;

  constructor(statePath: string, logger?: Logger) {
    this.statePath = statePath;
    this.lockPath = `${statePath}.lock`;
    this.logger = logger;
    ensureDir(path.dirname(statePath));
  }

  private load(): StateFile {
    return readJsonFile<StateFile>(this.statePath, { records: {}, version: 1 });
  }

  private save(state: StateFile): void {
    writeJsonFile(this.statePath, state);
  }

  get(id: string): WorkflowRecordState | undefined {
    return this.load().records[id];
  }

  list(status?: RecordStatus): WorkflowRecordState[] {
    const all = Object.values(this.load().records);
    return status ? all.filter((r) => r.status === status) : all;
  }

  ensurePending(id: string): WorkflowRecordState {
    const state = this.load();
    if (!state.records[id]) {
      state.records[id] = {
        id,
        status: 'PENDING',
        updatedAt: new Date().toISOString(),
      };
      this.save(state);
    }
    return state.records[id];
  }

  /**
   * Atomically claim a record for running. Returns null if already RUNNING
   * by another process (fresh lock) or already SUCCESS.
   */
  tryClaim(id: string): WorkflowRecordState | null {
    const unlock = acquireFileLock(this.lockPath);
    try {
      const state = this.load();
      const existing = state.records[id];
      if (existing?.status === 'SUCCESS') return null;
      if (existing?.status === 'RUNNING') {
        // Allow reclaim if stale (>30 min)
        const updated = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
        if (Date.now() - updated < 30 * 60 * 1000) {
          this.logger?.warning(`Record ${id} already RUNNING`, {
            recordId: id,
            action: 'tryClaim',
          });
          return null;
        }
      }

      const now = new Date().toISOString();
      const next: WorkflowRecordState = {
        ...(existing || { id }),
        id,
        status: 'RUNNING',
        startedAt: existing?.startedAt || now,
        updatedAt: now,
        error: undefined,
      };
      state.records[id] = next;
      this.save(state);
      return next;
    } finally {
      unlock();
    }
  }

  update(
    id: string,
    patch: Partial<Omit<WorkflowRecordState, 'id'>>,
  ): WorkflowRecordState {
    const unlock = acquireFileLock(this.lockPath);
    try {
      const state = this.load();
      const current = state.records[id] || {
        id,
        status: 'PENDING' as RecordStatus,
        updatedAt: new Date().toISOString(),
      };
      const next: WorkflowRecordState = {
        ...current,
        ...patch,
        id,
        updatedAt: new Date().toISOString(),
      };
      state.records[id] = next;
      this.save(state);
      return next;
    } finally {
      unlock();
    }
  }

  markSuccess(id: string, extra?: Partial<WorkflowRecordState>): WorkflowRecordState {
    return this.update(id, {
      status: 'SUCCESS',
      finishedAt: new Date().toISOString(),
      error: undefined,
      ...extra,
    });
  }

  markFailed(
    id: string,
    error: string,
    extra?: Partial<WorkflowRecordState>,
  ): WorkflowRecordState {
    return this.update(id, {
      status: 'FAILED',
      finishedAt: new Date().toISOString(),
      error,
      ...extra,
    });
  }

  /** Reset FAILED -> PENDING for retry. */
  resetFailed(id: string): WorkflowRecordState {
    return this.update(id, {
      status: 'PENDING',
      error: undefined,
      screenshot: undefined,
      finishedAt: undefined,
      currentStep: undefined,
    });
  }
}
