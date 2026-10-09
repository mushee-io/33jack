const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

function json(res, status, body) {
  res.status(status).json(body);
}

function allowedMimeType(value) {
  const mime = String(value || "").split(";")[0].trim().toLowerCase();
  const allowed = new Set([
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "video/webm",
    "video/mp4"
  ]);
  return allowed.has(mime) ? mime : "audio/webm";
}

function extensionForMime(mime) {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  return "webm";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

  const apiKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) {
    return json(res, 503, {
      error: "Voice transcription is not configured",
      detail: "GROQ_API_KEY is missing"
    });
  }

  try {
    const audioData = String(req.body?.audioData || "").trim();
    const mimeType = allowedMimeType(req.body?.mimeType);

    if (!audioData) {
      return json(res, 400, { error: "No voice recording received" });
    }

    let bytes;
    try {
      bytes = Buffer.from(audioData, "base64");
    } catch {
      return json(res, 400, { error: "Voice recording is not valid base64" });
    }

    if (!bytes.length) {
      return json(res, 400, { error: "Voice recording was empty" });
    }

    if (bytes.length > MAX_AUDIO_BYTES) {
      return json(res, 413, {
        error: "Voice recording is too large",
        detail: "Keep each 33Jack voice command under a few seconds."
      });
    }

    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes], { type: mimeType }),
      `33jack-command.${extensionForMime(mimeType)}`
    );
    form.append(
      "model",
      String(process.env.GROQ_WHISPER_MODEL || "whisper-large-v3-turbo").trim()
    );
    form.append("response_format", "json");
    form.append("language", "en");
    form.append(
      "prompt",
      "33Jack business finance voice command. Preserve person and company names, invoice references, currencies and amounts exactly."
    );

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return json(res, 502, {
        error: "Voice transcription failed",
        detail:
          data?.error?.message ||
          data?.message ||
          `Groq returned HTTP ${response.status}`
      });
    }

    const transcript = String(data?.text || "").trim();
    if (!transcript) {
      return json(res, 422, {
        error: "I could not hear a command in that recording",
        detail: "Try again and speak a little closer to the microphone."
      });
    }

    return json(res, 200, {
      ok: true,
      transcript,
      model: String(process.env.GROQ_WHISPER_MODEL || "whisper-large-v3-turbo").trim()
    });
  } catch (error) {
    return json(res, 500, {
      error: "Voice transcription failed",
      detail: error instanceof Error ? error.message : "Unexpected transcription error"
    });
  }
}
