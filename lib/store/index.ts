import { fileStore } from './file-store';
import type { Store } from './types';

export const store: Store = fileStore;
