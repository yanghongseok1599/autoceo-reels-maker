export type MockVideoJob = {
  id: string;
  createdAt: number;
  videoUrl: string;
};

const store = globalThis as typeof globalThis & {
  __autoceoJobs?: Map<string, MockVideoJob>;
};

export const mockJobs = store.__autoceoJobs ?? new Map<string, MockVideoJob>();

store.__autoceoJobs = mockJobs;

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
