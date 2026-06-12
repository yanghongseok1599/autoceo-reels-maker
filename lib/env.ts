export const env = {
  voiceboxBaseUrl: process.env.VOICEBOX_BASE_URL ?? "http://127.0.0.1:17493",
  voiceboxApiKey: process.env.VOICEBOX_API_KEY ?? "",
} as const;
