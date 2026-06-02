# My Customizations

Personal configuration and prompt-tuning decisions baked into this project.

## Resume tailoring (buildResumePrompt)

- **Skill structure**: Exactly 5 headings. Row 1 = "Languages", Row 5 = "Courses" (spans 2 lines). Rows 2–4 are job-matched (Frameworks, Developer Tools, Libraries, Cloud & DevOps, etc.).
- **Line length cap**: 105 visible characters per physical LaTeX line in the skills section.
- **Scope lock**: Only the Technical Skills section is modified; all other sections are untouched.
- **Skill pools**: `resumes/skills_*.txt` files are pre-read and fed to the LLM as named XML blocks.

## Cover letter (buildClPrompt)

- **Three paragraphs, fixed structure**:
  1. GRA hook — SadTalker lip-sync, NeMo TTS pipelines, CUDA/GPU optimization → specific JD requirement
  2. Project evidence — Predicare (Django + Kubernetes), Constrained Text Generation (Llama), Auto Vision (Flutter/TensorFlow); cite measurable outcomes from swe.tex
  3. Forward-looking + enthusiasm sentence specific to the company
- **Template**: `resumes/cover_letter_template.tex` preserves heading, contact line, margins, salutation, and sign-off.

## Anti-AI style rules (applied to all three endpoints)

These constraints are injected verbatim into every LLM prompt:

1. **Senior professor register** — dry, authoritative, empirical, understated. No flowery adjectives (no "passionate", "eager").
2. **No negation framing** — no "Not only X but also Y", no "It is not just X, it is Y". State things directly.
3. **No evaluative labeling** — no summary sentences tagging evidence (BANNED: "This reflects research maturity", "This demonstrates leadership").
4. **Indirect speech only** — no direct quotation marks for dialogue or internal thoughts.
5. **Banned words**: delve, foster, underscore, landscape, tapestry, testament, pivotal, invaluable, unwavering, commendable, meticulous, seamlessly, intersection, realm, prowess.
6. **No em dashes** — use semicolons, commas, or periods instead.
7. **No banned opening phrases**: "I am excited to apply", "I believe my skills", "I am writing to express", "I am passionate about", "leverage my experience".

## Cold message (buildColdMessagePrompt)

- Exactly 4 sentences, total character count strictly under 300.
- Must connect one specific technical theme from GRA work or projects to a concrete JD challenge.
- Cannot start with "I".

## Jake's Resume style constraints

- All LaTeX output must be syntactically valid Jake's Resume (`\documentclass{resume}`).
- No modification to section structure outside Technical Skills for `/tailor`.
- Special characters escaped: `&` → `\&`, `%` → `\%`, `$` → `\$`, `#` → `\#`, `_` → `\_`.

## Speed option: CLAUDE_MODEL

Set `CLAUDE_MODEL=claude-haiku-4-5-20251001` in `.env` to route the `claude` provider
through Haiku instead of the default model. Haiku is significantly faster (~3–5x)
and cheaper. Verify the 60–105 char line constraint and cover letter prose quality
are acceptable before relying on it in production. Omit the variable to use the
default (Sonnet).

```
CLAUDE_MODEL=claude-haiku-4-5-20251001
```

## pdflatex settings

- `-interaction=nonstopmode` to prevent interactive prompts on LaTeX errors.
- Output directory: `resumes/` (same dir as source `.tex`).
- Timeout: 60 seconds.
- Auxiliary files (`.aux`, `.log`, `.out`) are deleted after successful compilation.
