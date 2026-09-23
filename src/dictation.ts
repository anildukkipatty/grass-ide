import { jsonOk, jsonError, readBody, IRequest, IResponse } from "./server-common";

/**
 * Tap-to-talk dictation for the composer boxes.
 *
 * The browser records a clip and POSTs it here; the clip goes to Deepgram for
 * the raw transcript, and the transcript goes to gpt-4o-mini to strip filler
 * words and resolve self-corrections. Only the polished text goes back — the
 * raw dictation is never shown.
 *
 * Audio rides in as base64 inside a JSON body rather than a binary upload
 * because relay mode carries request bodies as strings.
 *
 * Needs DEEPGRAM_API_KEY and OPENAI_API_KEY in the environment.
 */

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen?model=nova-2-general&smart_format=true";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const CLEANUP_MODEL = "gpt-4o-mini";

// Roughly two minutes of opus; anything longer is a mistake, not a message.
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

const CLEANUP_PROMPT = `You are a voice transcription cleanup assistant.
The user will provide a raw voice transcript. Your job is light editing only — preserve their exact words and phrasing as much as possible.

Your task:
1. Remove filler words ("uh", "um", "er", "like") and false starts.
2. If the user spells out a word (e.g., "t-h-r-e-s-h-o-l-d"), replace the previous misspelled or unclear attempt with the correctly spelled word and drop the spelling itself.
3. Resolve simple self-corrections (e.g., "delete the file, actually remove the folder" → "remove the folder").
4. Apply light markdown formatting where it clearly fits: wrap code, file names, variable names, and commands in backticks; use a bullet list if the user enumerates multiple items.
5. Output ONLY the cleaned transcript. No explanations, no quotes, no commentary.

Do not paraphrase, summarize, reorder, or interpret — just clean up the words they said.`;

export function dictationConfigured(): { deepgram: boolean; openai: boolean } {
  return {
    deepgram: Boolean(process.env.DEEPGRAM_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
  };
}

async function transcribe(audio: Buffer, mimeType: string): Promise<string> {
  const res = await fetch(DEEPGRAM_URL, {
    method: "POST",
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      "Content-Type": mimeType,
    },
    body: new Uint8Array(audio),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Deepgram ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data: any = await res.json();
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
}

async function cleanUp(transcript: string): Promise<string> {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLEANUP_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: CLEANUP_PROMPT },
        { role: "user", content: transcript },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data: any = await res.json();
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}

/** Returns true when the request was handled. */
export async function handleDictationRoutes(req: IRequest, res: IResponse): Promise<boolean> {
  const path = (req.url ?? "/").split("?")[0];
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/dictate/status") {
    jsonOk(res, dictationConfigured());
    return true;
  }

  if (method === "POST" && path === "/dictate") {
    const keys = dictationConfigured();
    if (!keys.deepgram || !keys.openai) {
      const missing = [!keys.deepgram && "DEEPGRAM_API_KEY", !keys.openai && "OPENAI_API_KEY"].filter(Boolean);
      jsonError(res, 503, `Dictation is not configured: set ${missing.join(" and ")}`);
      return true;
    }

    const body = await readBody(req);
    const { audio, mimeType } = body ?? {};
    if (typeof audio !== "string" || !audio) { jsonError(res, 400, "audio is required"); return true; }
    if (typeof mimeType !== "string" || !mimeType.startsWith("audio/")) { jsonError(res, 400, "mimeType must be an audio type"); return true; }

    const bytes = Buffer.from(audio, "base64");
    if (bytes.length === 0) { jsonError(res, 400, "audio is empty"); return true; }
    if (bytes.length > MAX_AUDIO_BYTES) { jsonError(res, 413, "recording is too long"); return true; }

    try {
      const transcript = await transcribe(bytes, mimeType);
      if (!transcript.trim()) { jsonOk(res, { text: "" }); return true; }
      const text = await cleanUp(transcript);
      jsonOk(res, { text });
    } catch (err: any) {
      console.error(`[dictate] ${err?.message ?? err}`);
      jsonError(res, 502, err?.message ?? "Dictation failed");
    }
    return true;
  }

  return false;
}
