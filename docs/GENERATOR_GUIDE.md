# The Create Page — Plain-English Guide

This explains every generator and every piece of jargon on the `/create` page, written for someone who has never used an AI image tool before. Read top to bottom once and you'll understand the whole thing.

---

## 0. Live status (last tested 2026-06-03, neutral test prompts)

| Generator | Status | What was wrong / note |
|---|---|---|
| **Gemini (banana-maker)** — flash/pro/grounded | ✅ **WORKING** | Its Python `venv` was missing — rebuilt it (`google-genai`). Generated the test image fine. |
| **Local Image — sd-turbo** | ✅ **WORKING** | `venv` was deleted — rebuilt (torch cu130 + diffusers). Generated on the RTX 3070. |
| **Local Image — SDXL-Turbo** | ⏳ **Cached, needs RAM** | Downloaded & ready, but its load peak (~4–5GB) gets killed until WSL's RAM cap rises (see below). |
| **Local Video — LTX-Video** | ⏳ **Needs RAM** | Large model + CPU offload needs the raised RAM cap to run safely. |
| **Pollinations** — FLUX/SD free cloud | ⚠️ **Paywalled** | Free tier now returns **402** (1 request/IP max) and asks for paid bypass. Not a bug — their new pricing. Use Gemini or Local instead. |
| **Pika video** | 💳 **Credits** | Cloud, needs Pika credits topped up. |

**To unlock SDXL-Turbo + LTX-Video:** WSL was capped at 12GB of 31GB RAM. Cap raised to 24GB in `C:\Users\itsju\.wslconfig`; apply with `wsl --shutdown` from PowerShell (restarts WSL services), then both run.

---

## 1. The absolute basics

**AI image generation** = you type a description ("a red sports car on a mountain road at sunset"), and the computer paints a brand-new picture that matches it. Nothing is copied from the internet — it's drawn fresh each time.

**Prompt** = the text description you type. The clearer and more specific, the better the result. "A golden retriever puppy sitting in green grass, soft morning light" beats "a dog."

**Generate** = the button that starts the painting. It takes anywhere from 1 second to a few minutes depending on which generator you pick.

---

## 2. The jargon, decoded

| Term | What it actually means | Why you care |
|---|---|---|
| **Model** | The "artist's brain." A huge file the AI learned from. Different models = different art styles and strengths. Picking a model is like picking which painter does your commission. | This is the single biggest lever on how your image looks. |
| **Checkpoint** | Just another word for a **model** file. "Checkpoint" and "model" mean the same thing in practice. | Don't let the two words confuse you — same thing. |
| **Base model** | The original, general-purpose model made by a big lab (e.g. **SDXL** by Stability AI, **FLUX** by Black Forest Labs). Knows a bit of everything. | Safe default. Reliable, broad, no surprises. |
| **Fine-tune** | A base model that someone re-trained to be *great* at one specific look (e.g. photorealism, or anime). | Sharper results for a specific style, at the cost of being less general. |
| **LoRA** | A small "add-on" file that bolts onto a model to nudge it toward a particular style, character, or object — without replacing the whole model. Think of it as a filter or a costume layered on top of the artist's brain. | Lets you stack a style on top of a base model cheaply. Many LoRAs can be mixed. |
| **Steps** | How many passes the AI makes refining the image. More steps = more detail but slower. | "Turbo" models need only 1–4 steps. Normal models like 20–40. |
| **CFG / Guidance** | How *strictly* the AI obeys your prompt. Low = creative/loose. High = literal but can look over-cooked. | Most generators set this for you. Turbo models use 0 on purpose. |
| **Sampler / Scheduler** | The math recipe for turning noise into a picture. Different recipes = slightly different looks/speeds. | Defaults are fine for 99% of uses. |
| **Seed** | A number that locks in randomness. Same prompt + same seed = the same image every time. Change the seed = a fresh variation. | Use a fixed seed to tweak one image; random seed to explore options. |
| **VAE** | The final "developer" stage that converts the AI's internal data into the actual colored pixels you see. | Built in. You almost never touch it. |
| **Aspect ratio** | The shape of the image: `1:1` square, `16:9` widescreen, `9:16` tall (phone), etc. | Pick to match where the image will be used. |
| **Resolution / Size** | How many pixels (e.g. `1K`, `2K`, `4K`). Bigger = sharper but slower and heavier on the GPU. | `1K`–`2K` is the sweet spot for an 8GB GPU. |
| **txt2img** | "Text to image" — the normal mode: words in, picture out. | The default. |
| **img2img** | "Image to image" — feed it a starting picture *plus* a prompt to transform it. | For editing/restyling an existing image. |
| **Diffusion** | The underlying technique: the AI starts with random TV-static noise and gradually "denoises" it into your picture over the steps. | This is why it's called Stable **Diffusion** / a **diffusers** pipeline. |
| **GPU / VRAM** | The graphics card (your **RTX 3070**, 8GB) does the heavy math. VRAM = its memory. Big images/videos can run out of VRAM. | Local generators run on *your* GPU = free, private, but limited by 8GB. |
| **Turbo / distilled** | A model specially compressed to produce an image in 1–4 steps instead of 30. Much faster, slightly less detail. | Great for quick drafts. (SDXL-**Turbo** is the local default.) |

---

## 3. The generators on this page, and when to use each

Your Create page has **four** different engines. They are not the same — each has a trade-off.

| Generator | Where it runs | Cost | Speed | Best for | The catch |
|---|---|---|---|---|---|
| **Gemini ("banana-maker")** — flash / pro / grounded | Google's cloud | Uses paid Google credits | Fast | Clean, safe, high-quality general images; "grounded" can use real-world facts | Needs Google billing topped up; **won't** make adult content (Google blocks it) |
| **Pollinations** — FLUX, flux-realism, flux-anime, turbo, etc. | Free public cloud | **Free**, no key | Medium | Trying FLUX-quality results for free; lots of style variants | Shared free service — one request at a time per machine, or it returns a "402" busy error |
| **Local Image** — SDXL-Turbo / SD-Turbo | **Your** RTX 3070 | **Free** | Very fast (1–4 steps) | Private, offline, unlimited drafts | Limited by 8GB VRAM; quality below FLUX/Gemini |
| **Local Video** — LTX-Video | **Your** RTX 3070 | **Free** | Slow (minutes) | Short free video clips, fully private | Heavy on VRAM; keep clips short |

### Quick "which do I pick?" cheatsheet
- **I want the best quality and don't mind paying:** Gemini (pro) or Pollinations FLUX.
- **I want it free and private, right now:** Local Image (SDXL-Turbo).
- **I want a free video clip:** Local Video (LTX) — keep it short.
- **I got a "402" error:** that's just Pollinations saying "I'm busy, send one at a time" — wait a moment and retry, or switch to a Local generator.

---

## 4. Model vs LoRA, one more time (the part everyone mixes up)

- A **model/checkpoint** is the *whole brain*. You load exactly **one** at a time.
- A **LoRA** is a *small add-on* layered on top of that brain to push a specific style. You can stack **several** LoRAs on one model.
- Analogy: the **model** is the actor; **LoRAs** are the costume, the accent coach, and the lighting. Same actor, very different scene.

---

## 5. Common errors and what they mean
- **"402" / "Payment Required"** → Pollinations is busy (it only allows one job at a time per machine). Wait and retry, or use a Local generator.
- **"Gemini image credits are depleted"** → Google billing ran out. Top up at ai.studio.
- **"Local generator is not installed yet"** → the local Python environment is missing/broken (needs a rebuild).
- **"GPU out of memory"** → the image/video is too big for 8GB. Lower the resolution or close other GPU apps.
- **"timed out"** → first run also downloads the model (several GB). Try again once it finishes.

---

*This guide covers the engines and terminology only. It is intentionally style-neutral — it explains how the tools work so you can get the best results from whichever generator you choose.*
