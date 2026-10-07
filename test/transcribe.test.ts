import { describe, expect, test } from "bun:test";
import {
  createTranscriber,
  isAudioContentType,
  TranscriptionError,
  TRANSCRIBE_PROVIDERS,
  type TranscribeInput,
} from "../src/transcribe/index.ts";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

const input: TranscribeInput = {
  data: new Blob(["audio-bytes"], { type: "audio/ogg" }),
  filename: "voice.ogg",
  contentType: "audio/ogg; codecs=opus",
};

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fakeFetch(...responses: Response[]) {
  const calls: RecordedCall[] = [];
  const fetcher = (async (request: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(request), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("No canned response");
    return next;
  }) as typeof fetch;
  return { fetcher, calls };
}

function headers(call: RecordedCall): Headers {
  return new Headers(call.init.headers);
}

describe("OpenAI-shaped transcription providers", () => {
  const cases = [
    ["openai", "https://api.openai.com/v1/audio/transcriptions", "gpt-4o-mini-transcribe"],
    ["groq", "https://api.groq.com/openai/v1/audio/transcriptions", "whisper-large-v3-turbo"],
    ["together", "https://api.together.ai/v1/audio/transcriptions", "openai/whisper-large-v3"],
  ] as const;

  for (const [provider, url, defaultModel] of cases) {
    test(`${provider} sends the documented multipart request`, async () => {
      const fake = fakeFetch(response({ text: `${provider} transcript`, language: "en" }));
      const transcriber = createTranscriber({ provider, apiKey: "secret", fetch: fake.fetcher });
      const result = await transcriber.transcribe(input);

      expect(transcriber.model).toBe(defaultModel);
      expect(fake.calls[0]!.url).toBe(url);
      expect(fake.calls[0]!.init.method).toBe("POST");
      expect(headers(fake.calls[0]!).get("Authorization")).toBe("Bearer secret");
      const form = fake.calls[0]!.init.body;
      expect(form).toBeInstanceOf(FormData);
      expect((form as FormData).get("file")).toBeInstanceOf(Blob);
      expect((form as FormData).get("model")).toBe(defaultModel);
      expect((form as FormData).get("response_format")).toBe("json");
      expect(result).toEqual({ text: `${provider} transcript`, provider, model: defaultModel, language: "en" });
    });
  }

  test("mistral uses x-api-key and omits response_format", async () => {
    const fake = fakeFetch(response({ text: "bonjour" }));
    const transcriber = createTranscriber({ provider: "mistral", apiKey: "key", fetch: fake.fetcher });
    const result = await transcriber.transcribe(input);

    expect(fake.calls[0]!.url).toBe("https://api.mistral.ai/v1/audio/transcriptions");
    expect(headers(fake.calls[0]!).get("x-api-key")).toBe("key");
    expect(headers(fake.calls[0]!).get("Authorization")).toBeNull();
    const form = fake.calls[0]!.init.body as FormData;
    expect(form.get("model")).toBe("voxtral-mini-latest");
    expect(form.get("response_format")).toBeNull();
    expect(result.text).toBe("bonjour");
  });

  test("model, language, and trailing-slash baseUrl overrides apply", async () => {
    const fake = fakeFetch(response({ text: "hola" }));
    const transcriber = createTranscriber({
      provider: "openai",
      apiKey: "key",
      model: "custom-model",
      language: "es",
      baseUrl: "https://proxy.example/openai///",
      fetch: fake.fetcher,
    });
    await transcriber.transcribe(input);
    expect(fake.calls[0]!.url).toBe("https://proxy.example/openai/audio/transcriptions");
    const form = fake.calls[0]!.init.body as FormData;
    expect(form.get("model")).toBe("custom-model");
    expect(form.get("language")).toBe("es");
  });

  test("openai-compatible requires baseUrl but permits no API key", async () => {
    expect(() => createTranscriber({ provider: "openai-compatible" })).toThrow(TranscriptionError);
    const fake = fakeFetch(response({ text: "local" }));
    const transcriber = createTranscriber({
      provider: "openai-compatible",
      baseUrl: "http://localhost:8000/v1/",
      fetch: fake.fetcher,
    });
    const result = await transcriber.transcribe(input);
    expect(fake.calls[0]!.url).toBe("http://localhost:8000/v1/audio/transcriptions");
    expect(headers(fake.calls[0]!).has("Authorization")).toBe(false);
    expect((fake.calls[0]!.init.body as FormData).get("model")).toBe("whisper-1");
    expect(result.text).toBe("local");
  });
});

describe("provider-specific APIs", () => {
  test("deepgram sends raw audio and extracts transcript and detected language", async () => {
    const fake = fakeFetch(
      response({ results: { channels: [{ detected_language: "en", alternatives: [{ transcript: "deep words" }] }] } }),
    );
    const transcriber = createTranscriber({ provider: "deepgram", apiKey: "dg", fetch: fake.fetcher });
    const result = await transcriber.transcribe(input);

    expect(fake.calls[0]!.url).toBe("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&detect_language=true");
    expect(headers(fake.calls[0]!).get("Authorization")).toBe("Token dg");
    expect(headers(fake.calls[0]!).get("Content-Type")).toBe("audio/ogg");
    expect(fake.calls[0]!.init.body).toBe(input.data);
    expect(result).toEqual({ text: "deep words", provider: "deepgram", model: "nova-3", language: "en" });
  });

  test("deepgram base, model, and language overrides alter URL", async () => {
    const fake = fakeFetch(response({ results: { channels: [{ alternatives: [{ transcript: "oui" }] }] } }));
    await createTranscriber({
      provider: "deepgram",
      apiKey: "dg",
      baseUrl: "https://proxy/dg/",
      model: "nova-custom",
      language: "fr-FR",
      fetch: fake.fetcher,
    }).transcribe({ ...input, contentType: "" });
    expect(fake.calls[0]!.url).toBe("https://proxy/dg/listen?model=nova-custom&smart_format=true&language=fr-FR");
    expect(headers(fake.calls[0]!).get("Content-Type")).toBe("application/octet-stream");
  });

  test("assemblyai uploads, creates, polls, and completes", async () => {
    const fake = fakeFetch(
      response({ upload_url: "https://upload.example/audio" }),
      response({ id: "tx 1" }),
      response({ status: "queued" }),
      response({ status: "processing" }),
      response({ status: "completed", text: "assembled", language_code: "de" }),
    );
    const transcriber = createTranscriber({
      provider: "assemblyai",
      apiKey: "aa",
      language: "de",
      pollIntervalMs: 0,
      fetch: fake.fetcher,
    });
    const result = await transcriber.transcribe(input);

    expect(fake.calls.map((call) => call.url)).toEqual([
      "https://api.assemblyai.com/v2/upload",
      "https://api.assemblyai.com/v2/transcript",
      "https://api.assemblyai.com/v2/transcript/tx%201",
      "https://api.assemblyai.com/v2/transcript/tx%201",
      "https://api.assemblyai.com/v2/transcript/tx%201",
    ]);
    expect(headers(fake.calls[0]!).get("Authorization")).toBe("aa");
    expect(headers(fake.calls[0]!).get("Content-Type")).toBe("application/octet-stream");
    expect(fake.calls[0]!.init.body).toBe(input.data);
    const createBody = JSON.parse(String(fake.calls[1]!.init.body));
    expect(createBody).toEqual({
      audio_url: "https://upload.example/audio",
      speech_models: ["universal-3-5-pro"],
      language_code: "de",
    });
    expect(result).toEqual({ text: "assembled", provider: "assemblyai", model: "universal-3-5-pro", language: "de" });
  });

  test("assemblyai enables detection and reports provider error status safely", async () => {
    const secret = "assembly-secret";
    const fake = fakeFetch(
      response({ upload_url: "u" }),
      response({ id: "id" }),
      response({ status: "error", error: `${secret} ${"x".repeat(300)}` }),
    );
    const promise = createTranscriber({ provider: "assemblyai", apiKey: secret, pollIntervalMs: 0, fetch: fake.fetcher }).transcribe(input);
    await expect(promise).rejects.toBeInstanceOf(TranscriptionError);
    try {
      await promise;
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect((error as Error).message.length).toBeLessThan(240);
    }
    expect(JSON.parse(String(fake.calls[1]!.init.body))).toMatchObject({ language_detection: true });
  });

  test("elevenlabs sends multipart fields and extracts language", async () => {
    const fake = fakeFetch(response({ text: "eleven", language_code: "it" }));
    const result = await createTranscriber({
      provider: "elevenlabs",
      apiKey: "el",
      language: "it",
      baseUrl: "https://proxy/eleven/v1/",
      fetch: fake.fetcher,
    }).transcribe(input);
    expect(fake.calls[0]!.url).toBe("https://proxy/eleven/v1/speech-to-text");
    expect(headers(fake.calls[0]!).get("xi-api-key")).toBe("el");
    const form = fake.calls[0]!.init.body as FormData;
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("language_code")).toBe("it");
    expect(result.language).toBe("it");
  });

  test("gemini sends inline base64 audio and concatenates response parts", async () => {
    const fake = fakeFetch(response({ candidates: [{ content: { parts: [{ text: " hello" }, { text: " world " }] } }] }));
    const result = await createTranscriber({
      provider: "gemini",
      apiKey: "gm",
      language: "en-US",
      baseUrl: "https://proxy/gemini/v1beta/",
      fetch: fake.fetcher,
    }).transcribe(input);

    expect(fake.calls[0]!.url).toBe("https://proxy/gemini/v1beta/models/gemini-3.8-flash:generateContent");
    expect(headers(fake.calls[0]!).get("x-goog-api-key")).toBe("gm");
    const body = JSON.parse(String(fake.calls[0]!.init.body));
    expect(body.contents[0].parts[0].text).toEndWith(" The language is en-US.");
    expect(body.contents[0].parts[1].inline_data).toEqual({
      mime_type: "audio/ogg",
      data: Buffer.from("audio-bytes").toString("base64"),
    });
    expect(result).toEqual({ text: "hello world", provider: "gemini", model: "gemini-3.8-flash" });
  });

  test("gemini rejects inline audio over 20 MB without fetching", async () => {
    const fake = fakeFetch(response({}));
    const oversized = { ...input, data: new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]) };
    await expect(createTranscriber({ provider: "gemini", apiKey: "gm", fetch: fake.fetcher }).transcribe(oversized)).rejects.toBeInstanceOf(
      TranscriptionError,
    );
    expect(fake.calls).toHaveLength(0);
  });
});

describe("errors and helpers", () => {
  test("all hosted providers require an API key", () => {
    for (const provider of TRANSCRIBE_PROVIDERS) {
      if (provider === "openai-compatible") continue;
      expect(() => createTranscriber({ provider })).toThrow(TranscriptionError);
    }
  });

  test("non-2xx errors are bounded and redact the API key", async () => {
    const key = "super-secret-value";
    const fake = fakeFetch(new Response(`${key}: ${"bad".repeat(200)}`, { status: 429 }));
    const promise = createTranscriber({ provider: "openai", apiKey: key, fetch: fake.fetcher }).transcribe(input);
    await expect(promise).rejects.toBeInstanceOf(TranscriptionError);
    try {
      await promise;
    } catch (error) {
      expect((error as Error).message).toStartWith("openai HTTP 429: ");
      expect((error as Error).message).not.toContain(key);
      expect((error as Error).message.length).toBeLessThanOrEqual(218);
    }
  });

  test("empty transcript is valid", async () => {
    const fake = fakeFetch(response({ text: "" }));
    const result = await createTranscriber({ provider: "openai", apiKey: "key", fetch: fake.fetcher }).transcribe(input);
    expect(result.text).toBe("");
  });

  test("timeout rejects even when injected fetch ignores its signal", async () => {
    const never = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const promise = createTranscriber({ provider: "openai", apiKey: "key", timeoutMs: 20, fetch: never }).transcribe(input);
    await expect(promise).rejects.toBeInstanceOf(TranscriptionError);
    await expect(promise).rejects.toThrow("timed out");
  });

  test("isAudioContentType accepts audio MIME types and common extensions", () => {
    expect(isAudioContentType("audio/ogg; codecs=opus")).toBe(true);
    expect(isAudioContentType("AUDIO/MPEG")).toBe(true);
    expect(isAudioContentType("application/octet-stream", "VOICE.OPUS")).toBe(true);
    expect(isAudioContentType(undefined, "clip.m4a")).toBe(true);
    expect(isAudioContentType(null, "recording.webm")).toBe(true);
    expect(isAudioContentType("video/mp4", "movie.mp4")).toBe(false);
    expect(isAudioContentType(undefined, "audio.txt")).toBe(false);
  });
});

import { loadConfig } from "../src/config.ts";
import { transcriberFromConfig } from "../src/discord/gateway.ts";

describe("transcriberFromConfig", () => {
  const base = { DISCORD_BOT_TOKEN: "x", LETTA_API_KEY: "y", LETTA_AGENT_ID: "agent-1" };
  test("undefined when disabled; provider defaults otherwise", () => {
    expect(transcriberFromConfig(loadConfig(base))).toBeUndefined();
    const t = transcriberFromConfig(loadConfig({ ...base, TRANSCRIBE_PROVIDER: "groq", TRANSCRIBE_API_KEY: "k" }))!;
    expect([t.provider, t.model]).toEqual(["groq", "whisper-large-v3-turbo"]);
    const local = transcriberFromConfig(
      loadConfig({ ...base, TRANSCRIBE_PROVIDER: "openai-compatible", TRANSCRIBE_BASE_URL: "http://localhost:8000/v1", TRANSCRIBE_MODEL: "Systran/faster-whisper-small" }),
    )!;
    expect(local.model).toBe("Systran/faster-whisper-small");
  });
});
