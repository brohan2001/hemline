import { describe, it, expect } from 'vitest'
import { parsePageCount, graftSection, extractTailorOutput } from '../pipeline/latex.js'
import {
  buildResumePrompt, buildClPrompt, buildColdMessagePrompt, buildColdEmailPrompt, parseColdEmail,
} from '../pipeline/prompts.js'
import { tailorResume } from '../pipeline/tailor.js'

const DOC = `\\documentclass{article}
\\begin{document}
\\section{Education}
edu
\\section{Technical Skills}
old skills
\\section{Projects}
old projects
\\end{document}`

describe('parsePageCount', () => {
  it('reads a single-line report', () => {
    expect(parsePageCount('Output written on swe.pdf (2 pages, 1234 bytes).')).toBe(2)
  })

  it('reads a report hard-wrapped at 79 columns by pdflatex', () => {
    const wrapped = 'Output written on /Users/someone/Documents/jseek-extension/resumes/build/swe.pdf (1\n page, 107062 bytes).'
    expect(parsePageCount(wrapped)).toBe(1)
  })

  it('returns null when absent', () => {
    expect(parsePageCount('No pages of output.')).toBeNull()
  })
})

describe('graftSection with section-only LLM output', () => {
  const llm = '\\section{Technical Skills}\nnew skills\n\\section{Projects}\nnew projects\n```'

  it('replaces the last section without dropping \\end{document}', () => {
    const out = graftSection(graftSection(DOC, llm, 'Technical Skills'), llm, 'Projects')
    expect(out).toContain('new skills')
    expect(out).toContain('new projects')
    expect(out).not.toContain('old')
    expect(out).not.toContain('```')
    expect(out.trimEnd().endsWith('\\end{document}')).toBe(true)
    expect(out.match(/\\end\{document\}/g)).toHaveLength(1)
  })

  it('still works with a full-document LLM output', () => {
    const full = DOC.replace('old projects', 'full projects')
    expect(graftSection(DOC, full, 'Projects')).toContain('full projects')
  })
})

describe('extractTailorOutput', () => {
  it('prefers a full document', () => {
    expect(extractTailorOutput(`chatter ${DOC} trailing`)).toBe(DOC)
  })

  it('falls back to bare sections', () => {
    expect(extractTailorOutput('Here:\n\\section{Technical Skills}\nx')).toBe('\\section{Technical Skills}\nx')
  })

  it('returns null with neither', () => {
    expect(extractTailorOutput('sorry')).toBeNull()
  })
})

describe('prompts carry no hardcoded personal data', () => {
  const candidate = { name: 'Jane Doe', highlights: 'PhD robotics' }
  const prompts = [
    buildResumePrompt('jd', DOC, {}, 'pool'),
    buildClPrompt('jd', 'SWE', 'Acme', DOC, DOC, {}, candidate),
    buildColdMessagePrompt('jd', 'Acme', 'SWE', DOC, candidate),
    buildColdEmailPrompt('jd', 'Acme', 'SWE', DOC, candidate),
  ]

  it('never mentions the original author', () => {
    for (const p of prompts) expect(p).not.toMatch(/Rohan|Stony Brook|SadTalker|Predicare/)
  })

  it('uses the supplied candidate name and highlights', () => {
    expect(prompts[1]).toContain('Jane Doe')
    expect(prompts[1]).toContain('PhD robotics')
    expect(prompts[3]).toContain('Best regards,\\nJane Doe')
  })

  it('degrades gracefully without a candidate', () => {
    expect(buildColdMessagePrompt('jd', 'Acme', 'SWE', DOC)).toContain('the candidate')
  })
})

describe('parseColdEmail', () => {
  it('splits subject and body', () => {
    expect(parseColdEmail('Subject: Hi\n\nBody', 'SWE', 'Acme')).toEqual({ subject: 'Hi', body: 'Body' })
  })

  it('falls back to a default subject', () => {
    expect(parseColdEmail('Body only', 'SWE', 'Acme')).toEqual({ subject: 'Application for SWE at Acme', body: 'Body only' })
  })
})

describe('tailorResume page guard', () => {
  it('tightens spacing until the compile reports one page', async () => {
    const tex = DOC.replace('\\begin{document}', '\\addtolength{\\topmargin}{-.5in}\n\\addtolength{\\textheight}{1.0in}\n\\begin{document}')
    const pages = [2, 2, 1]
    const compiled = []
    const result = await tailorResume({
      jd: 'python', sweTex: tex, skills: {}, projectPool: null,
      callLlm: async () => '\\section{Technical Skills}\nnew skills\n',
      compile: async (t) => {
        compiled.push(t)
        const n = pages.shift()
        return { pdf: new Uint8Array([1]), log: `Output written on swe.pdf (${n} page${n > 1 ? 's' : ''}, 1 bytes).` }
      },
    })
    expect(compiled).toHaveLength(3)
    expect(result.pageCount).toBe(1)
    expect(result.tex).toContain('\\addtolength{\\topmargin}{-0.60in}')
  })

  it('attaches the LaTeX error when compile fails', async () => {
    const err = Object.assign(new Error('fail'), { log: '! Undefined control sequence.\nl.42 \\foo' })
    await expect(tailorResume({
      jd: 'python', sweTex: DOC, skills: {}, projectPool: null,
      callLlm: async () => '\\section{Technical Skills}\nx\n',
      compile: async () => { throw err },
    })).rejects.toMatchObject({ latexError: { message: 'Undefined control sequence.', line: 42 } })
  })
})
