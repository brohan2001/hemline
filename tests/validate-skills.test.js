import { describe, it, expect } from 'vitest'
import { parseSkillRows, validateRows, stripMarkup, extractSkillsBlock } from '../scripts/validate-skills.js'

const VALID_BLOCK = `\\section{Technical Skills}
 \\begin{itemize}[leftmargin=0.15in, label={}]
    \\small{\\item{
     \\textbf{Languages}{: Python, Java, JavaScript, TypeScript, Golang, C/C++, Bash, SQL} \\\\
     \\textbf{Frameworks}{: PyTorch, TensorFlow, Scikit-learn, Pandas, NumPy, Llama, NeMo, Hugging Face} \\\\
     \\textbf{Cloud}{: AWS, GCP, Azure, Docker, Kubernetes, Terraform, GitHub Actions, CI/CD, Jenkins} \\\\
     \\textbf{Tools}{: Git, Linux, Bash Scripting, Jupyter, Apache Spark, MLflow, PostgreSQL, Redis} \\\\
     \\textbf{Courses}{: Machine Learning, Natural Language Processing, Data Structures, Algorithms, Deep Learning, Probability and Statistics, Data Science, Computer Vision, Operating Systems}\\\\
    }}
 \\end{itemize}`

describe('stripMarkup', () => {
  it('strips LaTeX commands, braces, and escapes', () => {
    expect(stripMarkup('\\textbf{Cloud \\& DevOps}{: AWS, GCP}')).toBe('Cloud & DevOps: AWS, GCP')
  })
})

describe('parseSkillRows', () => {
  it('parses 5 rows with headings and single physical lines', () => {
    const rows = parseSkillRows(VALID_BLOCK)
    expect(rows.length).toBe(5)
    expect(rows[0].heading).toBe('Languages')
    expect(rows[4].heading).toBe('Courses')
    expect(rows[4].physicalLines.length).toBe(1)
  })
})

describe('validateRows', () => {
  it('passes a block meeting all constraints', () => {
    const v = validateRows(parseSkillRows(VALID_BLOCK))
    expect(v.passed).toBe(true)
    expect(v.violations).toEqual([])
  })

  it('flags a row exceeding 105 visible chars', () => {
    const overlong = VALID_BLOCK.replace(
      '{: PyTorch, TensorFlow, Scikit-learn, Pandas, NumPy, Llama, NeMo, Hugging Face}',
      '{: PyTorch, TensorFlow, Scikit-learn, Pandas, NumPy, Llama, NeMo, Hugging Face, Keras, JAX, XGBoost, LightGBM, OpenCV}'
    )
    const v = validateRows(parseSkillRows(overlong))
    expect(v.passed).toBe(false)
    expect(v.violations.some(viol => viol.rowIndex === 2 && viol.length > 105)).toBe(true)
  })

  it('flags a Courses row shorter than 150 chars', () => {
    const shortCourses = VALID_BLOCK.replace(
      /\\textbf\{Courses\}\{:[^}]*\}/,
      '\\textbf{Courses}{: Machine Learning, Deep Learning}'
    )
    const v = validateRows(parseSkillRows(shortCourses))
    expect(v.passed).toBe(false)
    expect(v.violations.some(viol => viol.rowIndex === 5 && viol.isCourses)).toBe(true)
  })

  it('fails when row 1 is not Languages', () => {
    const rows = parseSkillRows(VALID_BLOCK.replace('\\textbf{Languages}', '\\textbf{Tongues}'))
    expect(validateRows(rows).passed).toBe(false)
  })
})

describe('extractSkillsBlock', () => {
  it('returns null when the section is absent', () => {
    expect(extractSkillsBlock('\\documentclass{article}')).toBeNull()
  })
  it('extracts through end of itemize', () => {
    const block = extractSkillsBlock(`junk\n${VALID_BLOCK}\nmore`)
    expect(block.startsWith('\\section{Technical Skills}')).toBe(true)
    expect(block.endsWith('\\end{itemize}')).toBe(true)
  })
})
