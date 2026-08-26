export const env = {
  voiceboxBaseUrl: process.env.VOICEBOX_BASE_URL ?? "http://127.0.0.1:17493",
  voiceboxApiKey: process.env.VOICEBOX_API_KEY ?? "",
  fishBaseUrl: process.env.FISH_BASE_URL ?? "https://api.fish.audio",
  fishApiKey: process.env.FISH_API_KEY ?? "",
  fishTtsModel: process.env.FISH_TTS_MODEL ?? "s2.1-pro-free",
  fishReferenceId: process.env.FISH_REFERENCE_ID ?? "",
} as const;
