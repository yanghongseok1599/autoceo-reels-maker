import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type FishVoiceProfile = {
  id: string;
  name: string;
  language: string;
  sampleCount: number;
  createdAt: string;
};

const dataDir = path.join(process.cwd(), ".local-data");
const storePath = path.join(dataDir, "fish-voices.json");

async function readStore(): Promise<FishVoiceProfile[]> {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as FishVoiceProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeStore(profiles: FishVoiceProfile[]) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(storePath, JSON.stringify(profiles, null, 2), "utf8");
}

export async function listFishVoices() {
  return readStore();
}

export async function upsertFishVoice(profile: FishVoiceProfile) {
  const profiles = await readStore();
  await writeStore([profile, ...profiles.filter((item) => item.id !== profile.id)]);
  return profile;
}
