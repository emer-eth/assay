#!/usr/bin/env node
// Generates the demo voice-over with ElevenLabs: one MP3 per motion scene, then checks each fits its scene.
//
//   export ELEVENLABS_API_KEY=...      (in your own terminal; never commit it or paste it anywhere)
//   node scripts/voice.mjs             all six clips
//   node scripts/voice.mjs 3           only clip 3 (after you change its line)
//   node scripts/voice.mjs --voices    list the voices on your account, to pick a VOICE_ID
//
// Optional: VOICE=Brian (a voice on your account, by name) or VOICE_ID=... (default "George"), SPEED=0.95 (0.7 to 1.2)

import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const LINES = [
  { file: "01-before-you-trust", sec: 4, text: "Before you trust a NEAR contract, hire a swarm to check it." },
  { file: "02-post-a-job", sec: 5, text: "Name the contract, set a budget, and it's locked in escrow on chain." },
  { file: "03-sealed-bids", sec: 6, text: "AI agents bid sealed. The best track record per NEAR wins, so cheap, sloppy agents lose." },
  { file: "04-every-claim", sec: 5, text: "A private reviewer checks every claim against the code and the chain." },
  { file: "05-settled", sec: 5, text: "Passing work gets paid. The rest, or everything if it fails, comes back." },
  { file: "06-end-card", sec: 5, text: "Assay. Live on NEAR testnet, and your AI can hire it too." },
];

// --script <file>: voice a longer script instead (a JSON list of { id, vo }), saved as v2-<id>.mp3.
// The demo video uses this: node scripts/voice.mjs --script demo-video/script.json
const scriptAt = process.argv.indexOf("--script");
if (scriptAt > 0) {
  const { readFileSync } = await import("node:fs");
  LINES.length = 0;
  for (const s of JSON.parse(readFileSync(process.argv[scriptAt + 1], "utf8"))) LINES.push({ file: `v2-${s.id}`, sec: 999, text: s.vo });
}

const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
const SPEED = Number(process.env.SPEED || 1);
const OUT = join(process.cwd(), "demo-audio");
const API = "https://api.elevenlabs.io/v1";

if (!KEY) {
  console.error("No ElevenLabs key found. Add it to the ELEVENLABS_API_KEY= line in .env (git-ignored) and run `npm run demo:voice`, or export it in this terminal.");
  process.exit(1);
}

if (process.argv.includes("--voices")) {
  const r = await fetch(`${API}/voices`, { headers: { "xi-api-key": KEY } });
  if (!r.ok) fail(r.status, await r.text());
  const { voices } = await r.json();
  for (const v of voices) console.log(`${v.voice_id}  ${v.name}${v.labels?.description ? "  ·  " + v.labels.description : ""}`);
  process.exit(0);
}

// VOICE=Brian picks a voice on your account by name instead of by ID.
let VOICE_PICKED = VOICE;
// The demo video is narrated by Brian unless VOICE says otherwise.
const NAME = process.env.VOICE || (scriptAt > 0 && !process.env.VOICE_ID ? "Brian" : "");
if (NAME) {
  const r = await fetch(`${API}/voices`, { headers: { "xi-api-key": KEY } });
  if (!r.ok) fail(r.status, await r.text());
  const { voices } = await r.json();
  const want = NAME.toLowerCase();
  const v = voices.find((x) => x.name.toLowerCase() === want) || voices.find((x) => x.name.toLowerCase().startsWith(want));
  if (!v) { console.error(`No voice called "${NAME}" on your account. Run with --voices to see them.`); process.exit(1); }
  VOICE_PICKED = v.voice_id;
  console.log(`Voice: ${v.name}\n`);
}

const only = scriptAt > 0 ? 0 : Number(process.argv[2]);
const todo = only ? LINES.filter((_, i) => i + 1 === only) : LINES;
if (!todo.length) { console.error(`There's no clip ${process.argv[2]}. Pick 1 to ${LINES.length}.`); process.exit(1); }

await mkdir(OUT, { recursive: true });
let over = 0;
for (const line of todo) {
  const r = await fetch(`${API}/text-to-speech/${VOICE_PICKED}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text: line.text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: SPEED },
    }),
  });
  if (!r.ok) fail(r.status, await r.text());
  const path = join(OUT, `${line.file}.mp3`);
  await writeFile(path, Buffer.from(await r.arrayBuffer()));
  const len = duration(path);
  const fits = len == null ? "length unknown" : len <= line.sec ? `fits (${len.toFixed(1)}s of ${line.sec}s)` : `TOO LONG (${len.toFixed(1)}s of ${line.sec}s)`;
  if (len != null && len > line.sec) over++;
  console.log(`${line.file}.mp3  ${fits}`);
}
console.log(`\nSaved in ${OUT}`);
if (over) console.log("Some clips run long: try SPEED=1.1, or shorten the line in LINES and run again with its number.");

function duration(path) {
  try {
    const out = execFileSync("afinfo", [path], { encoding: "utf8" });
    const m = out.match(/estimated duration:\s*([\d.]+)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function fail(status, body) {
  const hint = status === 401 ? "The API key was refused: check it, or make a new one in ElevenLabs." : status === 429 ? "Out of credits or rate-limited: wait, or check your ElevenLabs usage." : "";
  console.error(`ElevenLabs answered ${status}. ${hint}\n${body.slice(0, 300)}`);
  process.exit(1);
}
