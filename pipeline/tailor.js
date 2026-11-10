import {
  buildResumePrompt, buildClPrompt, buildColdMessagePrompt, buildColdEmailPrompt, parseColdEmail,
} from './prompts.js'
import {
  extractLatex, extractTailorOutput, validateLlmSkills, graftSkillsSection, graftProjectsSection,
  graftPreamble, sanitizeSkillsAmpersands, applySkillsLineTrimmer, parsePageCount,
  tightenVerticalSpacing, extractLatexError,
} from './latex.js'
import { sanitizeLatex } from './sanitize.js'
import { computeMatchScore } from './score.js'

// Environment-agnostic pipelines shared by server.js (pdflatex + CLI/relay) and the
// extension (WASM pdfTeX + direct API calls). Callers inject:
//   callLlm(prompt) -> Promise<string>
//   compile(tex)    -> Promise<{ pdf, log }>  (rejects with err.log/err.stdout on failure)
//   log(event)      -> optional diagnostics sink

async function compileOrExplain(compile, tex) {
  try {
    return await compile(tex)
  } catch (err) {
    err.latexError ??= extractLatexError(err.log ?? err.stdout)
    throw err
  }
}

export async function tailorResume({ jd, sweTex, skills, projectPool, callLlm, compile, log = () => {} }) {
  const prompt = buildResumePrompt(jd, sweTex, skills, projectPool)
  log({ event: 'tailor_request', promptLen: prompt.length, prompt })

  let raw = await callLlm(prompt)
  let llmTex = extractTailorOutput(raw)
  if (!llmTex) throw new Error(`LLM output did not contain valid LaTeX (output preview: ${raw.slice(0, 300)})`)

  let validation = validateLlmSkills(llmTex)
  log({ event: 'tailor_validation', attempt: 1, passed: validation.passed, violations: validation.violations })
  if (!validation.passed) {
    const feedback = validation.violations
      .map(v => v.reason ?? `Row ${v.rowIndex} ("${v.heading}") line ${v.lineIndex} was ${v.length} visible chars; allowed range is ${v.isCourses ? '150-200' : '60-105'}.`)
      .join('\n')
    const retryPrompt = `${prompt}\n\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION:\n${feedback}\nRegenerate the same output fixing only these violations.`
    try {
      const retryRaw = await callLlm(retryPrompt)
      const retryTex = extractTailorOutput(retryRaw)
      if (retryTex) {
        const retryValidation = validateLlmSkills(retryTex)
        log({ event: 'tailor_validation', attempt: 2, passed: retryValidation.passed, violations: retryValidation.violations })
        // Keep whichever attempt is cleaner; the trimmer handles any residue.
        if (retryValidation.passed || retryValidation.violations.length < validation.violations.length) {
          raw = retryRaw
          llmTex = retryTex
          validation = retryValidation
        }
      }
    } catch (err) {
      log({ event: 'tailor_retry_error', error: err.message })
    }
  }
  log({ event: 'tailor_llm_output', outputLen: raw.length, rawOutput: raw })

  const grafted = graftProjectsSection(graftSkillsSection(sweTex, llmTex), llmTex)
  let { tex } = sanitizeLatex(applySkillsLineTrimmer(sanitizeSkillsAmpersands(grafted)))

  let result = await compileOrExplain(compile, tex)
  let pageCount = parsePageCount(result.log)
  for (let attempt = 1; pageCount > 1 && attempt <= 5; attempt++) {
    tex = tightenVerticalSpacing(tex)
    result = await compileOrExplain(compile, tex)
    pageCount = parsePageCount(result.log)
  }

  const match = computeMatchScore(jd, tex)
  log({ event: 'tailor_match_score', ...match })
  return { pdf: result.pdf, tex, match, pageCount, validation }
}

export async function writeCoverLetter({ jd, jobTitle, companyName, sweTex, clTemplate, skills, candidate, callLlm, compile, log = () => {} }) {
  const prompt = buildClPrompt(jd, jobTitle, companyName, sweTex, clTemplate, skills, candidate)
  log({ event: 'cl_request', promptLen: prompt.length, prompt })
  const raw = await callLlm(prompt)
  const llmTex = extractLatex(raw)
  if (!llmTex) throw new Error(`LLM output did not contain valid LaTeX (output preview: ${raw.slice(0, 300)})`)
  const tex = graftPreamble(clTemplate, llmTex)
  log({ event: 'cl_llm_output', outputLen: tex.length, rawOutput: raw })
  const result = await compileOrExplain(compile, tex)
  return { pdf: result.pdf, tex }
}

export async function writeColdMessage({ jd, companyName, jobTitle, sweTex, candidate, callLlm }) {
  return (await callLlm(buildColdMessagePrompt(jd, companyName, jobTitle, sweTex, candidate))).trim()
}

export async function writeColdEmail({ jd, companyName, jobTitle, sweTex, candidate, callLlm, log = () => {} }) {
  const prompt = buildColdEmailPrompt(jd, companyName, jobTitle, sweTex, candidate)
  log({ event: 'cold_email_request', prompt })
  const raw = await callLlm(prompt)
  log({ event: 'cold_email_output', rawOutput: raw })
  return parseColdEmail(raw, jobTitle, companyName)
}
