// candidate = { name, highlights }. highlights is free text the user writes once
// (degree, standout research/projects) so the prompts can name concrete hooks
// without hardcoding any one person's background.

const STYLE_RULES = `1. Tone: Write in the register of a senior professor. Be dry, authoritative, empirical, and understated. Do not use flowery adjectives such as passionate or eager.
2. No negation framing: Do not use constructions like "Not only X, but also Y", "It is not just X, it is Y", or "This is X, not Y". State what the candidate did directly; do not define them by contrast or negation.
3. No evaluative labeling: Do not end paragraphs with summary sentences that tag or evaluate the evidence (e.g., BANNED: "This reflects research maturity", "This demonstrates leadership"). Trust the reader to draw conclusions from the evidence itself.
4. Indirect speech only: Never use direct quotation marks to quote dialogue or internal thoughts.
5. Banned words: Never use any of the following words or their derivatives: delve, foster, underscore, landscape, tapestry, testament, pivotal, invaluable, unwavering, commendable, meticulous, seamlessly, intersection, realm, prowess.
6. No em dashes: Do not use em dashes anywhere in the output. Use semicolons, commas, or periods instead.`

function candidateName(candidate) {
  return candidate?.name?.trim() || 'the candidate'
}

function highlightsHint(candidate) {
  const h = candidate?.highlights?.trim()
  return h
    ? `the candidate's strongest experience (${h})`
    : 'the most relevant experience, research, or degree work on the resume'
}

function skillsBlock(skills) {
  return Object.entries(skills ?? {})
    .map(([name, content]) => `<${name}>\n${content}\n</${name}>`)
    .join('\n\n')
}

export function buildResumePrompt(jobDescription, sweTex, skills, projectPool) {
  const projectInstructions = projectPool
    ? `
Here is the project pool:
<project_pool>
${projectPool}
</project_pool>

Also produce the Projects section with these strict constraints:
- Analyze the job description and select the 3 projects from the project pool that best match its requirements.
- The Projects section must contain exactly those 3 projects, copied VERBATIM from the pool. Do not rewrite, shorten, or merge any bullet.
- Keep the \\resumeSubHeadingListStart / \\resumeSubHeadingListEnd wrapper around the 3 projects exactly as in the current document.
`
    : ''

  return `You are editing a LaTeX resume.

Here is the current resume:
<resume_tex>
${sweTex}
</resume_tex>

Here are the skill pools:
${skillsBlock(skills)}
${projectInstructions}
The target job description is:
<job_description>
${jobDescription.trim()}
</job_description>

Rewrite the Technical Skills section with these strict constraints:
- Exactly 5 skill headings total.
- Row 1 heading must be "Languages".
- Rows 2, 3, and 4: choose headings that best match the job description (e.g., "Frameworks", "Developer Tools", "Libraries", "Cloud \\& DevOps").
- Row 5 heading must be "Courses". All course names must fit on a single physical line; do NOT insert a \\\\ line break within the Courses row. The total visible characters of the Courses line must be strictly between 150 and 200.
- Pull skills from the skill pools that match keywords in the job description.
- Add any critical missing skills explicitly required by the job description (e.g., Docker, Kubernetes) if not already present.
- Every physical line of skills content (ignoring LaTeX markup like \\textbf{}, \\item, \\\\) must produce strictly between 60 and 105 characters of visible PDF text. If a line is too short, pack it with more relevant, matching keywords from the skill pools to maximize ATS keyword density, but do not exceed 105 characters.
- CRITICAL: In LaTeX, the ampersand character & is a reserved alignment tab. Always write it as \\& inside \\textbf{} headings and skill content (e.g., \\textbf{Cloud \\& DevOps}, never \\textbf{Cloud & DevOps}).
- Keep the same LaTeX structure (\\begin{itemize}, \\small{\\item{...}}) as the current Technical Skills section.

Output ONLY the \\section{Technical Skills} block${projectPool ? ' followed by the \\section{Projects} block' : ''}, as raw LaTeX. Do not output the preamble, any other section, or \\end{document}. No explanation, no markdown fences, no commentary.`
}

export function buildClPrompt(jd, jobTitle, companyName, sweTex, clTemplate, skills, candidate) {
  const name = candidateName(candidate)
  return `You are a technical career advisor writing a highly personalized cover letter. Your output must be a complete, valid LaTeX document and nothing else.

Here is ${name}'s resume:
<resume_tex>
${sweTex}
</resume_tex>

Here is the cover letter template:
<cover_letter_template>
${clTemplate}
</cover_letter_template>

Here are the skill pools:
${skillsBlock(skills)}

The target job description is:
<job_description>
${jd.trim()}
</job_description>

Write a 3-paragraph cover letter body for ${name} applying to the role of "${jobTitle}" at "${companyName}".

Paragraph rules:
- Paragraph 1: Open with a specific hook directly connecting ${highlightsHint(candidate)} to a concrete technical requirement stated in the job description. Be specific; name the requirement.
- Paragraph 2: Highlight 1-2 projects or roles from the resume that are most relevant to this JD. Cite any measurable outcomes that appear in the resume (percentages, latency numbers, scale figures). Never invent facts that are not in the resume.
- Paragraph 3: One short forward-looking paragraph on what ${name} will bring to the team. Close with one specific sentence expressing genuine enthusiasm for this role at ${companyName}; avoid generic phrasing.

STRICT PROSE STYLE AND ANTI-AI CONSTRAINTS (DO NOT VIOLATE):
${STYLE_RULES}
7. Sentence rhythm: Avoid staccato chains of short Subject-Verb-Object sentences. Connect complex thoughts fluidly using subordinating conjunctions such as although, while, because, given that, and whereas.

LaTeX formatting rules (strictly follow these):
- Replace [Paragraph 1], [Paragraph 2], and [Paragraph 3] in the template with the three paragraphs above.
- Escape ALL special characters: & becomes \\&, % becomes \\%, $ becomes \\$, # becomes \\#, _ becomes \\_
- Do NOT use any of these banned phrases: "I am excited to apply", "I believe my skills", "I am writing to express", "I am passionate about", "leverage my experience".
- Preserve all other template content (heading, contact line, margins, "Dear Hiring Manager", sign-off) exactly as written in the template.

Output the complete final LaTeX document. Output ONLY the raw LaTeX; no explanation, no markdown fences, no commentary.`
}

export function buildColdMessagePrompt(jd, companyName, jobTitle, sweTex, candidate) {
  const name = candidateName(candidate)
  return `You are writing a LinkedIn connection request message for ${name}.
Output ONLY the message text: no explanation, no quotes, no preamble, no markdown.

Here is ${name}'s resume for context:
<resume_tex>
${sweTex}
</resume_tex>

Target role: "${jobTitle}" at "${companyName}".
Job description:
<job_description>
${jd.trim()}
</job_description>

Write exactly 4 sentences. Count the total characters carefully; the combined character count of all 4 sentences must be strictly under 300 characters.

Connect one specific technical theme from ${highlightsHint(candidate)} directly to a concrete challenge stated in the job description. Never invent facts that are not in the resume.

STRICT ANTI-AI STYLE RULES (DO NOT VIOLATE):
${STYLE_RULES}
7. Do not start with "I".

Output ONLY the message. Nothing else.`
}

export function buildColdEmailPrompt(jd, companyName, jobTitle, sweTex, candidate) {
  const name = candidateName(candidate)
  const signOff = candidate?.name?.trim() ? `Sign off with "Best regards,\\n${name}".` : 'Sign off with "Best regards," and the name from the resume.'
  return `You are writing a cold recruiter email for ${name}.
Output the email as plain text: first line must be "Subject: <subject under 80 chars>", then a blank line, then the email body. Nothing else; no explanation, no markdown.

Here is ${name}'s resume for context:
<resume_tex>
${sweTex}
</resume_tex>

Target role: "${jobTitle}" at "${companyName}".
Job description:
<job_description>
${jd.trim()}
</job_description>

Write a 3-paragraph email body:
- Paragraph 1: Open with a specific hook connecting ${highlightsHint(candidate)} to a concrete requirement in the job description.
- Paragraph 2: Highlight 1-2 of the most relevant projects or roles from the resume, citing measurable outcomes that appear in it. Never invent facts that are not in the resume.
- Paragraph 3: One short closing paragraph requesting a brief conversation about the role. ${signOff}

STRICT ANTI-AI STYLE RULES (DO NOT VIOLATE):
${STYLE_RULES}

Output ONLY the subject line and email. Nothing else.`
}

// One-time onboarding: converts a pasted plain-text resume into the bundled LaTeX template.
export function buildResumeImportPrompt(resumeText, templateTex) {
  return `Convert the plain-text resume below into LaTeX using the template exactly.

<template_tex>
${templateTex}
</template_tex>

<resume_text>
${resumeText.trim()}
</resume_text>

Rules:
- Keep the template preamble and custom commands (\\resumeSubheading, \\resumeItem, \\resumeProjectHeading, etc.) unchanged; replace only the placeholder content.
- Use the sections Education, Technical Skills, Projects, Work Experience, in the template's order. Keep a \\section{Technical Skills} and a \\section{Projects} even if short.
- Copy facts verbatim. Never invent employers, dates, metrics, or skills.
- Escape LaTeX special characters in content: & -> \\&, % -> \\%, $ -> \\$, # -> \\#, _ -> \\_.
- Keep it to one page: at most 3 projects and the most recent roles.

Output ONLY the complete LaTeX document from \\documentclass to \\end{document}. No markdown fences, no commentary.`
}

export function parseColdEmail(text, jobTitle, companyName) {
  const trimmed = text.trim()
  const m = trimmed.match(/^Subject:\s*(.+)/)
  return {
    subject: m ? m[1].trim() : `Application for ${jobTitle} at ${companyName}`.trim(),
    body: m ? trimmed.slice(m[0].length).trim() : trimmed,
  }
}
