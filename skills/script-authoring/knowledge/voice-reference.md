# Voice Reference — Kokoro TTS (onnx-community/Kokoro-82M-ONNX v1.0)

## The 4-Voice Rotation (Accordo Standard)

We rotate through four voices in all narrated presentations:

| Order | Voice | Role | Gender | Best for |
|-------|-------|------|--------|---------|
| 1st | `bf_emma` | General purpose | 🇬🇧 female | Everything — default for most content |
| 2nd | `af_nicole` | Technical voice | 🇺🇸 female | Long/detailed/complex — code reviews, deep dives |
| 3rd | `bm_george` | Architecture voice | 🇬🇧 male | Design decisions, architecture explanations |
| 4th | `bm_lewis` | Findings / reviews | 🇬🇧 male | Conclusions, recommendations, reviews |

**Rotation rule:** Alternate between the British voices and `af_nicole`. Start with `bf_emma`, rotate through each for the body of a presentation. This variety keeps the audience engaged.

---

## Quality Grades Explained

Each voice is rated on:
- **Target Quality** — How high quality is the reference voice?
- **Training Duration** — How much audio was seen during training?

  - `HH` = 10–100 hours
  - `H` = 1–10 hours
  - `MM` = 10–100 minutes
  - `*M*` = 1–10 minutes

Overall grades: A > A- > B+ > B > B- > C+ > C > D > F+

---

## American English — Female (11)

| Voice ID | Grade | Training | Description |
|----------|-------|----------|-------------|
| `af_heart` | **A** | HH hours | Warmest, most expressive. Best for storytelling and high-engagement demos |
| `af_bella` | **A-** | HH hours | Warm, slightly dramatic. Premium presentations |
| `af_nicole` | **B-** | HH hours | **Technical voice.** Natural, professional, easy to listen to long-term |
| `af_kore` | B | H hours | Good neutral. Versatile |
| `af_alloy` | B | H hours | Steady, professional. Reliable all-rounder |
| `af_aoede` | B | H hours | Light, clear. Fast-paced |
| `af_nova` | B | H hours | Modern, crisp. Tech-forward |
| `af_sarah` | C+ | H hours | Neutral, professional. Safe fallback |
| `af_sky` | C- | *M* minutes | Youthful, light. Quick summaries |
| `af_river` | D | MM minutes | Soft, quiet |
| `af_jessica` | D | MM minutes | Lower register |

## American English — Male (9)

| Voice ID | Grade | Training | Description |
|----------|-------|----------|-------------|
| `am_michael` | B | H hours | Clear, authoritative |
| `am_fenrir` | B | H hours | Deep, resonant. Formal presentations |
| `am_puck` | B | H hours | Bright, energetic |
| `am_adam` | D | H hours | Lower, slower |
| `am_echo` | D | MM minutes | Mid-range, neutral |
| `am_eric` | D | MM minutes | Steady, standard |
| `am_liam` | D | MM minutes | Light, quick |
| `am_onyx` | D | MM minutes | Deep, serious |
| `am_santa` | D- | *M* minutes | Warm, festive |

## British English — Female (4)

| Voice ID | Grade | Training | Description |
|----------|-------|----------|-------------|
| `bf_emma` | **B-** | HH hours | **General purpose voice.** Warmest and most natural British female. Best all-rounder |
| `bf_isabella` | C | MM minutes | Bright, clear. Instructional |
| `bf_alice` | D | MM minutes | Light, soft. Gentle |
| `bf_lily` | D | MM minutes | Quiet, soft. Calming |

## British English — Male (4)

| Voice ID | Grade | Training | Description |
|----------|-------|----------|-------------|
| `bm_george` | C | MM minutes | **Architecture voice.** Formal, measured, authoritative |
| `bm_lewis` | D+ | H hours | **Reviews / findings voice.** Clear, convincing, professional |
| `bm_fable` | C | MM minutes | Warm British male. Approachable formal |
| `bm_daniel` | D | MM minutes | Deep, serious. Authoritative |

## Other Languages

| Voice ID | Language | Grade | Notes |
|----------|----------|-------|-------|
| `ff_siwis` | 🇫🇷 French | B- | Best non-English. Warm French female |
| `if_sara` | 🇮🇹 Italian | C | Warm Italian female |
| `ef_dora` | 🇪🇸 Spanish | — | Clear Spanish female |
| `pm_alex` | 🇧🇷 Portuguese | — | Brazilian male |
| `hf_alpha` | 🇮🇳 Hindi | C | Hindi female |
| `hf_beta` | 🇮🇳 Hindi | C | Hindi female |
| `jf_alpha` | 🇯🇵 Japanese | C+ | Best Japanese female |
| `jf_gongitsune` | 🇯🇵 Japanese | C | Soft Japanese |
| `zm_yunyang` | 🇨🇳 Mandarin | — | Mandarin male |
| `zf_xiaobei` | 🇨🇳 Mandarin | D | Mandarin female |

**❌ Not available:** Hebrew, Arabic, Persian, Turkish, Korean, Russian. Kokoro supports only: English, French, Japanese, Mandarin, Spanish, Hindi, Italian, Portuguese.

---

## Voice Blending

Kokoro supports blending two voices together. **Correct syntax:** `voice1,voice2` (comma-separated, no ratio).

Examples:
- `bf_emma,bf_lily` — warm Emma + soft Lily. Gentle, approachable British female
- `bf_emma,bf_isabella` — Emma + bright Isabella. Friendly instructional voice
- `bf_emma,bf_alice` — Emma + soft Alice. Very approachable
- `bm_george,bm_lewis` — formal George + clear Lewis. Authoritative British male
- `af_heart,af_bella` — warm + warm. Extra expressive American female
- `af_bella,af_nicole` — warm + natural. Professional American female blend
- `am_michael,am_fenrir` — clear + deep male. Authoritative American male

**Do not use:** colon-separated ratios like `voice:0.5:voice:0.5` — these return 404 errors.

Speed multiplier: `0.5–2.0` (default: `1.0`). For narrated scripts, use `0.9–1.1` to keep pacing natural. `1.0` is recommended for most demos.
