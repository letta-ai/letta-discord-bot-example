export type TranscribeProviderName =
  | "openai"
  | "groq"
  | "mistral"
  | "together"
  | "deepgram"
  | "assemblyai"
  | "elevenlabs"
  | "gemini"
  | "openai-compatible";

export const TRANSCRIBE_PROVIDERS = [
  "openai",
  "groq",
  "mistral",
  "together",
  "deepgram",
  "assemblyai",
  "elevenlabs",
  "gemini",
  "openai-compatible",
] as const satisfies readonly TranscribeProviderName[];

export interface TranscriberOptions {
  provider: TranscribeProviderName;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  language?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
}

export interface TranscribeInput {
  data: Blob;
  filename: string;
  contentType: string;
}

export interface TranscribeResult {
  text: string;
  provider: TranscribeProviderName;
  model: string;
  language?: string;
}

export interface Transcriber {
  readonly provider: TranscribeProviderName;
  readonly model: string;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionError";
  }
}

type Json = Record<string, any>;

const DEFAULT_MODELS: Record<TranscribeProviderName, string> = {
  openai: "gpt-4o-mini-transcribe",
  groq: "whisper-large-v3-turbo",
  mistral: "voxtral-mini-latest",
  together: "openai/whisper-large-v3",
  deepgram: "nova-3",
  assemblyai: "universal-3-5-pro",
  elevenlabs: "scribe_v2",
  gemini: "gemini-3.8-flash",
  "openai-compatible": "whisper-1",
};

const DEFAULT_BASES: Record<TranscribeProviderName, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.ai/v1",
  deepgram: "https://api.deepgram.com/v1",
  assemblyai: "https://api.assemblyai.com/v2",
  elevenlabs: "https://api.elevenlabs.io/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  "openai-compatible": "",
};

const AUDIO_EXTENSIONS = new Set([".ogg", ".oga", ".opus", ".mp3", ".m4a", ".wav", ".webm", ".flac", ".aac"]);
const GEMINI_INLINE_LIMIT = 20 * 1024 * 1024;

export function isAudioContentType(contentType: string | null | undefined, filename?: string): boolean {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (normalized?.startsWith("audio/")) return true;
  if (!filename) return false;
  const lower = filename.toLowerCase();
  return [...AUDIO_EXTENSIONS].some((extension) => lower.endsWith(extension));
}

function normalizeContentType(contentType: string): string {
  return contentType.split(";", 1)[0]!.trim() || "application/octet-stream";
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function redactAndTruncate(value: unknown, apiKey?: string): string {
  let text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (apiKey) text = text.split(apiKey).join("[REDACTED]");
  return text.slice(0, 200);
}

async function responseJson(
  response: Response,
  provider: TranscribeProviderName,
  apiKey?: string,
): Promise<Json> {
  const body = await response.text();
  if (!response.ok) {
    const snippet = redactAndTruncate(body || response.statusText, apiKey);
    throw new TranscriptionError(`${provider} HTTP ${response.status}: ${snippet}`);
  }
  if (!body) return {};
  try {
    return JSON.parse(body) as Json;
  } catch {
    throw new TranscriptionError(`${provider} returned invalid JSON`);
  }
}

function aborted(provider: TranscribeProviderName): TranscriptionError {
  return new TranscriptionError(`${provider} request timed out`);
}

async function fetchWithSignal(
  fetchImpl: typeof fetch,
  provider: TranscribeProviderName,
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  signal: AbortSignal,
  apiKey?: string,
): Promise<Response> {
  if (signal.aborted) throw aborted(provider);

  let listener: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    listener = () => reject(aborted(provider));
    signal.addEventListener("abort", listener, { once: true });
  });

  try {
    return await Promise.race([fetchImpl(input, { ...init, signal }), abortPromise]);
  } catch (error) {
    if (error instanceof TranscriptionError) throw error;
    const detail = redactAndTruncate(error instanceof Error ? error.message : error, apiKey);
    throw new TranscriptionError(`${provider} request failed${detail ? `: ${detail}` : ""}`);
  } finally {
    if (listener) signal.removeEventListener("abort", listener);
  }
}

function sleep(ms: number, signal: AbortSignal, provider: TranscribeProviderName): Promise<void> {
  if (signal.aborted) return Promise.reject(aborted(provider));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", cancel);
      resolve();
    }
    function cancel() {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      reject(aborted(provider));
    }
    signal.addEventListener("abort", cancel, { once: true });
  });
}

function result(
  provider: TranscribeProviderName,
  model: string,
  text: unknown,
  language?: unknown,
): TranscribeResult {
  return {
    text: typeof text === "string" ? text : "",
    provider,
    model,
    ...(typeof language === "string" && language ? { language } : {}),
  };
}

export function createTranscriber(opts: TranscriberOptions): Transcriber {
  const { provider } = opts;
  if (!TRANSCRIBE_PROVIDERS.includes(provider)) {
    throw new TranscriptionError(`Unsupported transcription provider: ${String(provider)}`);
  }
  if (provider !== "openai-compatible" && !opts.apiKey) {
    throw new TranscriptionError(`${provider} requires an API key`);
  }
  if (provider === "openai-compatible" && !opts.baseUrl) {
    throw new TranscriptionError("openai-compatible requires baseUrl");
  }

  const apiKey = opts.apiKey;
  const model = opts.model ?? DEFAULT_MODELS[provider];
  const base = stripTrailingSlashes(opts.baseUrl ?? DEFAULT_BASES[provider]);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1_000;
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  return {
    provider,
    model,
    async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
      if (provider === "gemini" && input.data.size > GEMINI_INLINE_LIMIT) {
        throw new TranscriptionError("gemini inline audio exceeds 20 MB");
      }

      const signal = AbortSignal.timeout(timeoutMs);
      const request = (url: string, init: RequestInit) =>
        fetchWithSignal(fetchImpl, provider, url, init, signal, apiKey);
      const jsonRequest = async (url: string, init: RequestInit) =>
        responseJson(await request(url, init), provider, apiKey);

      if (provider === "openai" || provider === "groq" || provider === "together" || provider === "mistral" || provider === "openai-compatible") {
        const form = new FormData();
        form.append("file", input.data, input.filename);
        form.append("model", model);
        if (opts.language) form.append("language", opts.language);
        if (provider !== "mistral") form.append("response_format", "json");

        const headers = new Headers();
        if (provider === "mistral") headers.set("x-api-key", apiKey!);
        else if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
        const body = await jsonRequest(`${base}/audio/transcriptions`, { method: "POST", headers, body: form });
        return result(provider, model, body.text, body.language);
      }

      if (provider === "deepgram") {
        const query = new URLSearchParams({ model, smart_format: "true" });
        if (opts.language) query.set("language", opts.language);
        else query.set("detect_language", "true");
        const body = await jsonRequest(`${base}/listen?${query}`, {
          method: "POST",
          headers: {
            Authorization: `Token ${apiKey!}`,
            "Content-Type": normalizeContentType(input.contentType),
          },
          body: input.data,
        });
        const channel = body.results?.channels?.[0];
        return result(provider, model, channel?.alternatives?.[0]?.transcript, channel?.detected_language);
      }

      if (provider === "assemblyai") {
        const headers = { Authorization: apiKey! };
        const upload = await jsonRequest(`${base}/upload`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/octet-stream" },
          body: input.data,
        });
        const created = await jsonRequest(`${base}/transcript`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            audio_url: upload.upload_url,
            speech_models: [model],
            ...(opts.language ? { language_code: opts.language } : { language_detection: true }),
          }),
        });
        const id = encodeURIComponent(String(created.id ?? ""));
        for (;;) {
          const polled = await jsonRequest(`${base}/transcript/${id}`, { method: "GET", headers });
          if (polled.status === "completed") {
            return result(provider, model, polled.text, polled.language_code);
          }
          if (polled.status === "error") {
            throw new TranscriptionError(`assemblyai transcription error: ${redactAndTruncate(polled.error, apiKey)}`);
          }
          await sleep(pollIntervalMs, signal, provider);
        }
      }

      if (provider === "elevenlabs") {
        const form = new FormData();
        form.append("file", input.data, input.filename);
        form.append("model_id", model);
        if (opts.language) form.append("language_code", opts.language);
        const body = await jsonRequest(`${base}/speech-to-text`, {
          method: "POST",
          headers: { "xi-api-key": apiKey! },
          body: form,
        });
        return result(provider, model, body.text, body.language_code);
      }

      const mimeType = normalizeContentType(input.contentType);
      const bytes = await input.data.arrayBuffer();
      const prompt =
        "Transcribe this audio verbatim. Return only the transcript text, with no preamble, labels, or timestamps." +
        (opts.language ? ` The language is ${opts.language}.` : "");
      const body = await jsonRequest(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey!, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: Buffer.from(bytes).toString("base64") } },
              ],
            },
          ],
        }),
      });
      const parts = body.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts)
        ? parts.map((part: Json) => (typeof part?.text === "string" ? part.text : "")).join("").trim()
        : "";
      return result(provider, model, text);
    },
  };
}
