import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import net from 'net'
import { spawn } from 'child_process'
import { homedir } from 'os'
import { extractSkillsBlock, parseSkillRows, validateRows } from './validate-skills.js'

const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const RESUMES_DIR = path.join(__dirname, '..', 'resumes')
const REPORT_PATH = path.join(RESUMES_DIR, 'model_benchmark_report_v2.md')
const RELAY_URL   = 'http://localhost:8000/v1/chat/completions'
const MODEL_TIMEOUT_MS = 90_000

// ─── Job Descriptions ────────────────────────────────────────────────────────

const JD_GOOGLE_SWE = `Google LLC – Senior Software Engineer, Systems & Platform Engineering

Location: Sunnyvale, CA (Hybrid)  |  Level: L5–L6  |  Team: Core Infrastructure

About Google's Platform Engineering Team
Google's Core Systems and Platform Engineering group builds the foundational infrastructure underpinning every major Google product — Search, Gmail, YouTube, Maps, and Google Cloud. We design and operate distributed storage engines, compute scheduling systems, global networking fabrics, and developer-facing platform APIs that process hundreds of billions of requests per day at sub-millisecond latencies. Our work directly defines Google's competitive advantage: faster, more reliable, and more cost-efficient infrastructure that no other company can replicate at scale.

Role Summary
As a Senior Software Engineer on the Platform team, you will own complex multi-quarter initiatives spanning the full stack of systems software — from Linux kernel interactions and memory management to distributed consensus protocols and globally replicated storage engines. You will collaborate closely with SRE, Networking, and Product teams, and drive technical decisions affecting billions of users.

Core Responsibilities
• Design and implement large-scale distributed systems components: consensus algorithms (Paxos/Raft variants), distributed transaction coordinators, and fault-tolerant replication pipelines serving 10M+ QPS with five-nines availability SLOs.
• Own performance-critical C++ subsystems: custom memory allocators, lock-free data structures, SIMD-optimized compute kernels, and zero-copy I/O paths in the Linux networking stack.
• Lead architecture reviews and produce detailed design documents (PRDs, TDDs) for foundational platform components consumed by 200+ internal and external engineering teams.
• Build and maintain observability infrastructure: custom Prometheus exporters, structured logging pipelines (Fluentd, Cloud Logging), latency histograms, and SLO dashboards.
• Implement and evolve internal RPC frameworks (gRPC, Protocol Buffers) including schema evolution, backwards-compatible API versioning, and streaming RPC patterns for petabyte-scale data movement.
• Contribute to storage system internals: LSM-tree compaction strategies in Bigtable-style engines, distributed B-tree indexes, write-ahead log (WAL) management, and cross-datacenter replication using Spanner-style TrueTime semantics.
• Operate services in production: participate in on-call rotations, author runbooks, conduct blameless post-mortems, and drive reliability improvements that reduce MTTR by ≥30%.
• Mentor junior and mid-level engineers; conduct technical interviews; contribute to team-level OKR setting and roadmap planning.

Minimum Qualifications
• Bachelor's or Master's degree in Computer Science, Computer Engineering, or equivalent practical experience.
• 5+ years of professional software engineering experience with production systems at internet scale.
• Expert proficiency in C++ (C++17/20) and/or Go, with proven experience in performance-sensitive, multi-threaded, lock-free programming.
• Deep understanding of OS internals: virtual memory, huge pages, NUMA, process scheduling, file systems (ext4, XFS, io_uring), and network stack tuning (TCP window scaling, BPF, DPDK).
• Hands-on experience designing, building, and operating distributed systems: consistent hashing, vector clocks, distributed snapshots, lease-based coordination, and leader election.
• Proficiency in Python for tooling, automation, data analysis, and integration tests.
• Experience with container orchestration: Kubernetes (or Borg), Helm chart authoring, custom controllers/operators, and cluster autoscaler internals.

Preferred Qualifications
• Experience contributing to open-source systems projects (LLVM, Linux kernel, RocksDB, etcd, gRPC-core).
• Working knowledge of hardware-aware programming: CPU cache hierarchies, branch prediction, SIMD intrinsics (AVX-512), memory bandwidth optimization.
• Familiarity with formal verification methods (TLA+, Alloy) for distributed protocol correctness.
• Experience with chaos engineering frameworks (Chaos Monkey, Litmus) and fault injection in production.
• Proficiency with observability tooling: Grafana dashboards, Prometheus alerting rules, OpenTelemetry instrumentation, Jaeger distributed tracing.
• Experience using Apache Kafka or Apache Pulsar for high-throughput event streaming pipelines.
• Familiarity with Terraform and GitHub Actions for infrastructure-as-code and CI/CD automation.

Tech Stack: C++17/20, Go, Python, gRPC, Protocol Buffers, Kubernetes, Prometheus, Grafana, Apache Kafka, Terraform, Bigtable, Spanner, GitHub Actions, Bash, Linux.`

const JD_AMAZON_ML = `Amazon.com, Inc. – Machine Learning Engineer II, Gamer AI & Recommendation Systems

Location: Seattle, WA / Remote  |  Team: Prime Gaming & Alexa Games AI  |  Level: SDE II / MLE II

About the Team
The Gamer AI and Recommendation Systems team at Amazon sits at the intersection of gaming, machine learning, and real-time personalization. We build the recommendation engine powering Prime Gaming, Alexa Games, Amazon Luna, and Twitch discovery surfaces — delivering personalized game recommendations, in-game item suggestions, and live event highlights to over 400 million Amazon customers globally. Our infrastructure processes 2TB of event data per hour from gaming clients, cloud gaming sessions, and Twitch streams, feeding online and offline ML pipelines that must produce latency-sensitive recommendations in under 15 milliseconds end-to-end.

Role Summary
As an MLE II, you will own the full machine learning lifecycle for one or more recommendation product surfaces: from feature engineering and offline model training to real-time serving optimization and A/B experiment analysis. You will partner with applied scientists and software development engineers to push the frontiers of deep learning–based recommendation, reinforcement learning for dynamic content sequencing, and large-scale retrieval systems.

Core Responsibilities
• Design, train, and productionize deep learning recommendation models using PyTorch and TensorFlow, including two-tower retrieval models, transformer-based sequential recommendation (SASRec, BERT4Rec), and graph neural networks for user–item interaction modeling.
• Build and maintain feature engineering pipelines using Apache Spark (PySpark), AWS Glue, and Amazon Kinesis Data Streams; engineer real-time features from streaming click events, session context, and device telemetry.
• Develop and manage ML model serving infrastructure on Amazon SageMaker: multi-model endpoints, shadow deployments, canary rollouts, and auto-scaling policies to maintain p99 latency under 12ms at 50K RPS.
• Implement A/B testing and multi-armed bandit frameworks; measure business KPIs (CTR, session depth, D7 retention) with rigorous statistical significance testing (t-tests, bootstrap sampling, causal inference with DiD estimators).
• Manage datasets in Amazon S3 and Amazon DynamoDB; design efficient data access patterns for low-latency feature lookups using DynamoDB DAX and ElastiCache (Redis).
• Develop monitoring dashboards for model health: data drift detection (KL divergence, PSI metrics), prediction confidence calibration, and model staleness alerts using Amazon CloudWatch and Grafana.
• Write production-quality Python code following Amazon's operational excellence tenets; conduct code reviews; author technical design documents.
• Collaborate with Twitch ML Platform, Prime Video Recommendations, and Amazon Advertising ML teams to share model architectures and reuse feature stores across organizations.

Minimum Qualifications
• Bachelor's or Master's degree in Computer Science, Machine Learning, Statistics, or a related quantitative field.
• 3+ years of experience building and deploying production ML models at scale.
• Strong proficiency in Python; experience with PyTorch and/or TensorFlow for model development; familiarity with scikit-learn, Pandas, NumPy, and Hugging Face Transformers.
• Hands-on experience with distributed data processing: Apache Spark (PySpark or Scala), AWS Glue, or equivalent.
• Experience with AWS services: S3, DynamoDB, SageMaker, Kinesis, Lambda, EMR, EC2, and IAM.
• Understanding of recommendation system architectures: collaborative filtering, matrix factorization, approximate nearest-neighbor (ANN) search (FAISS, ScaNN), and two-stage retrieve-and-rank pipelines.
• Experience with MLflow or equivalent for experiment tracking, model versioning, and artifact management.
• Proficiency in SQL and NoSQL data stores; familiarity with data warehousing on Amazon Redshift or Snowflake.

Preferred Qualifications
• Experience with online learning and real-time model update pipelines (parameter servers, federated updates).
• Familiarity with reinforcement learning for recommendation: contextual bandits (LinUCB, Thompson Sampling), offline policy evaluation (IPS, doubly robust estimators).
• Experience with graph neural networks for recommendation (PinSage, LightGCN, GraphSAGE).
• Proficiency with Docker and Kubernetes for containerized ML workflows; experience with AWS EKS or ECS.
• Knowledge of ONNX runtime, TensorRT, or torch.compile for inference optimization.
• Prior experience at a gaming company, ad-tech firm, or streaming platform handling petabyte-scale behavioral data.
• Published research in RecSys, KDD, NeurIPS, ICML, or equivalent ML venues.

Tech Stack: Python, PyTorch, TensorFlow, Scikit-learn, Pandas, NumPy, Apache Spark, AWS (SageMaker, S3, DynamoDB, Kinesis, Redshift, Lambda, ECS, EMR), Redis, MLflow, Airflow, Docker, Kubernetes, Grafana, Prometheus, GitHub Actions, Terraform.`

const JD_UHG_CLOUD = `UnitedHealth Group – Senior Cloud Infrastructure Architect

Location: Minnetonka, MN (Hybrid) / Remote  |  Team: Optum Technology Cloud Platform  |  Level: Principal Engineer / Architect

About Optum Technology
Optum Technology is UnitedHealth Group's enterprise technology arm, responsible for building and operating the cloud infrastructure underpinning claims processing, prior authorization systems, member portals, pharmacy benefit management (PBM), and clinical analytics platforms serving over 150 million patients and 1.3 million healthcare providers nationwide. We manage one of the largest HIPAA-regulated cloud estates in the world — a hybrid multi-cloud environment spanning AWS, Azure, and on-premises data centers — with strict regulatory obligations under HIPAA, HITRUST CSF, SOC 2 Type II, and FedRAMP Moderate frameworks.

Role Summary
As a Senior Cloud Infrastructure Architect, you will own the design, automation, and operational governance of Optum's next-generation cloud infrastructure platform. You will set architectural standards for infrastructure-as-code (IaC), define multi-cloud networking topologies, lead the migration of legacy on-premises workloads to AWS and Azure, and champion developer-productivity tooling that reduces time-to-infrastructure from weeks to minutes.

Core Responsibilities
• Architect and implement scalable, highly available, HIPAA-compliant cloud infrastructure using Terraform (HCL), Terragrunt, and AWS CDK; manage 400+ Terraform modules and a multi-account AWS Organization with Control Tower governance policies.
• Design and operate multi-region Kubernetes clusters (Amazon EKS and Azure AKS) supporting 800+ microservices; define cluster autoscaler policies, Pod Disruption Budgets, Network Policies (Calico, Cilium), and multi-tenant namespace RBAC.
• Implement end-to-end CI/CD pipelines using GitHub Actions, ArgoCD (GitOps), Jenkins, and AWS CodePipeline; integrate policy-as-code gates using Open Policy Agent (OPA) and Checkov for Terraform plan validation.
• Design and enforce cloud security architectures compliant with HIPAA Security Rule, HITRUST CSF v11, and CMS ARS 3.1: VPC segmentation, PrivateLink endpoints, Transit Gateway hub-and-spoke, AWS GuardDuty, Security Hub, and Macie for PHI detection.
• Build observability stacks: deploy Prometheus Operator and Thanos for multi-cluster metrics federation; configure Grafana dashboards and PagerDuty alerting rules for golden-signal SLOs; ship structured logs via Fluent Bit to AWS OpenSearch Service.
• Automate infrastructure drift detection and compliance reporting using AWS Config, Security Hub custom insights, and Bridgecrew Checkov in CI; generate automated SOC 2 evidence artifacts for annual audits.
• Manage database infrastructure: Amazon RDS Aurora (PostgreSQL/MySQL) multi-AZ deployments, read replicas, and automated failover; Amazon DynamoDB global tables for low-latency transactional data; Redis ElastiCache clusters for session and cache layers.
• Lead architecture review board (ARB) sessions; produce reference architectures, architecture decision records (ADRs), and runbooks adopted org-wide.
• Mentor a team of 6 cloud engineers; define team OKRs and quarterly roadmap; manage vendor relationships with AWS and HashiCorp.

Minimum Qualifications
• Bachelor's degree in Computer Science, Information Systems, or equivalent.
• 8+ years of infrastructure engineering experience; 4+ years specifically architecting AWS at enterprise scale.
• Expert-level proficiency in Terraform (HCL); experience managing large Terraform codebases with remote state (S3 + DynamoDB locking), module registries, and workspace-based multi-environment strategies.
• Deep knowledge of AWS services: VPC, EC2, ECS, EKS, Lambda, API Gateway, RDS Aurora, DynamoDB, S3, CloudFront, Route 53, IAM, KMS, CloudWatch, CloudTrail, Config, GuardDuty, Security Hub, Transit Gateway.
• Proficiency in Kubernetes: CRDs, operators, Helm chart authoring, HPA/KEDA autoscaling, and service mesh concepts (Istio, Linkerd).
• Strong scripting skills in Python, Bash, and/or Go for infrastructure automation, Lambda function development, and CLI tooling.
• Hands-on experience with Docker multi-stage builds, image scanning (Snyk, Trivy), and private ECR/ACR registry management.
• Proven track record operating HIPAA-regulated cloud workloads and passing third-party compliance audits (HITRUST, SOC 2).

Preferred Qualifications
• AWS certifications: Solutions Architect Professional, DevOps Engineer Professional, Security Specialty.
• Experience with Azure: AKS, Azure AD (Entra ID), Defender for Cloud, Azure DevOps Pipelines, and ARM/Bicep templates.
• Familiarity with FinOps practices: AWS Cost Explorer, Spot instance orchestration (Karpenter), Reserved Instance planning, and Kubecost for chargeback.
• Experience with Ansible or Chef for configuration management; HashiCorp Vault for secrets management and PKI.
• Knowledge of eBPF-based observability tools: Pixie, Cilium Hubble, or Falco for runtime security monitoring.
• Prior healthcare IT experience (Epic, Cerner, HL7 FHIR API integrations) is a strong plus.

Tech Stack: Terraform, Kubernetes (EKS/AKS), AWS (full suite), Azure, Docker, Helm, ArgoCD, GitHub Actions, Jenkins, Prometheus, Grafana, Python, Go, Bash, Ansible, HashiCorp Vault, Checkov, OPA.`

const JD_COGNIZANT_CPP = `Cognizant Technology Solutions – Senior Embedded/C++ Software Engineer, High-Throughput Unix Systems

Location: Austin, TX (On-Site)  |  Client: Tier-1 Financial Exchange & Trading Systems  |  Level: Senior / Lead

About the Engagement
Cognizant's Financial Services Technology practice is seeking a Senior Embedded/C++ Software Engineer for a long-term engagement with a top-tier US financial exchange. The client operates a co-located, ultra-low-latency order matching engine processing over 5 million messages per second with deterministic sub-microsecond tick-to-trade latency requirements. The platform runs on bare-metal Linux servers with DPDK-based kernel bypass networking, user-space TCP/IP stacks, and NUMA-aware memory allocation. This role demands expert-level systems programming on Unix/Linux platforms, a deep understanding of hardware-software co-design, and the ability to work in a rigorous, safety-critical engineering culture.

Role Summary
You will be part of the core matching engine team, responsible for designing, implementing, and profiling the C++ subsystems that process incoming FIX/ITCH/OUCH protocol messages, maintain order books, and execute match-trade operations with deterministic latency guarantees. You will also contribute to the engineering platform: build tooling, CI/CD pipelines, static analysis automation, and capacity-planning simulation frameworks.

Core Responsibilities
• Design and implement high-performance C++17/20 systems components for the order matching engine: lock-free SPSC/MPSC queue implementations, memory pool allocators (slab, arena, buddy), and wait-free ring buffers for inter-thread communication with nanosecond-level overhead.
• Profile and optimize critical path code using Linux perf, Intel VTune, and Valgrind Callgrind; analyze CPU cache miss rates, branch misprediction penalties, and false-sharing hotspots; apply data-oriented design (DoD) principles to restructure data layouts for cache efficiency.
• Develop and maintain POSIX-compliant multi-threaded components using pthreads, C++ std::thread, and std::atomic; implement reader-writer locks, futex-based synchronization, and NUMA-aware thread affinity bindings via libnuma and cpuset.
• Write high-throughput TCP/UDP socket servers handling 100K+ concurrent connections; implement zero-copy sendfile() and splice() I/O paths; tune socket buffer sizes, TCP_NODELAY, and IP_MULTICAST_TTL for multicast feed handlers.
• Implement and maintain shared-memory IPC (POSIX shm_open, mmap, SysV shmget) for ultra-low-latency message passing between matching engine processes; design memory-mapped circular buffers with release-acquire barrier semantics.
• Manage the full software build toolchain: CMake (3.20+) with custom toolchain files, Clang 16 (LTO, PGO, sanitizers), and Conan package management; author reproducible CI/CD pipelines with GitHub Actions and Jenkins with ASAN/UBSAN/TSAN gates on every pull request.
• Debug production defects using GDB (scripted with Python GDB API), rr (Mozilla's deterministic record-and-replay debugger), and AddressSanitizer/LeakSanitizer; investigate kernel-space issues using strace, ltrace, ftrace, and perf-sched for scheduler latency spikes.
• Write unit tests using Google Test (gtest/gmock); benchmark critical paths with Google Benchmark and nanobench; maintain a regression test harness validating tick-to-trade latency SLAs (p50/p99/p999) against historical market replay datasets.
• Participate in design reviews for low-level hardware features: RDMA (InfiniBand/RoCE v2), AVX-512 SIMD vectorization for order book scan operations, huge page (2MB/1GB) TLB management, and DPDK poll-mode driver configuration.
• Mentor junior engineers on C++ best practices: RAII, move semantics, perfect forwarding, template metaprogramming (TMP), and compile-time computation with constexpr.

Minimum Qualifications
• Bachelor's or Master's degree in Computer Science, Electrical Engineering, or equivalent.
• 6+ years of professional C++ (C++14/17) development experience in production Unix/Linux environments.
• Expert knowledge of POSIX APIs: pthreads, epoll/kqueue, timerfd, eventfd, signalfd, POSIX AIO, and POSIX semaphores.
• Proficiency with memory management: custom allocators, memory-mapped files (mmap/madvise/mlock), huge pages, and NUMA-aware allocation patterns.
• Deep experience with IPC mechanisms: POSIX shared memory, message queues (mq_open), pipes, and Unix domain sockets.
• Strong debugging skills: GDB scripting, Valgrind (Memcheck, Helgrind, DRD), strace/ltrace, perf stat/record, and AddressSanitizer/ThreadSanitizer.
• Solid understanding of CPU architecture: cache coherence protocols (MESI), memory barriers, hardware prefetcher behavior, and SIMD intrinsics (SSE4.2, AVX2).
• Proficiency with CMake build system and CI/CD tooling (GitHub Actions, Jenkins, Buildkite).

Preferred Qualifications
• Experience with DPDK (Data Plane Development Kit) or kernel-bypass networking (RDMA, RoCE).
• Familiarity with FIX, ITCH (NASDAQ), or OUCH protocol parsers for market data and order entry.
• Experience with real-time OS scheduling policies (SCHED_FIFO, SCHED_RR, PREEMPT_RT Linux kernel patches).
• Knowledge of eBPF/XDP for kernel-bypass packet processing and custom network monitors.
• Proficiency in Python for scripting, data analysis, and GDB automation.

Tech Stack: C/C++17/20, POSIX APIs, pthreads, mmap/IPC, CMake, Clang, GDB, Valgrind, ASAN/TSAN, perf, Linux, GitHub Actions, Jenkins, Python, Google Test, Google Benchmark, DPDK, AVX-512.`

const JOB_DESCRIPTIONS = [
  { id: 'google-swe-systems',     label: 'Google – Senior SWE (Systems/Platform)',             text: JD_GOOGLE_SWE },
  { id: 'amazon-ml-engineer',     label: 'Amazon – ML Engineer (Gamer AI/Recommendation)',     text: JD_AMAZON_ML  },
  { id: 'uhg-cloud-architect',    label: 'UHG – Cloud Infrastructure Architect (DevOps/AWS)',  text: JD_UHG_CLOUD  },
  { id: 'cognizant-embedded-cpp', label: 'Cognizant – Embedded/C++ Developer (Unix Systems)',  text: JD_COGNIZANT_CPP },
]

// ─── Model Hierarchy ──────────────────────────────────────────────────────────

const INTENT_HIERARCHY = [
  'google/gemini-3.5-flash',
  'groq/gpt-oss-120b',
  'groq/llama-3.3-70b-versatile',
  'groq/qwen3-32b',
  'google/gemini-2.5-flash',
  'cerebras/zai-glm-4.7',
  'google/gemma-4-31b',
  'groq/llama-4-scout-17b',
  'google/gemma-4-26b',
  'groq/groq-compound',
  'groq/gpt-oss-20b',
  'groq/groq-compound-mini',
  'groq/llama-3.1-8b-instant',
  'google/gemini-3-flash',
  'google/gemini-3.1-flash-lite',
  'google/gemini-2.5-flash-lite',
  'groq/allam-2-7b',
  'groq/orpheus-v1-english',
  'groq/orpheus-arabic-saudi',
]

// ─── Relay Startup ────────────────────────────────────────────────────────────

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error',   () => { socket.destroy(); resolve(false) })
    socket.connect(port, '127.0.0.1')
  })
}

async function waitForReady(maxAttempts = 20, intervalMs = 1500) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch('http://localhost:8000/health')
      if (res.ok) return true
    } catch {}
    await new Promise(r => setTimeout(r, intervalMs))
    process.stdout.write('.')
  }
  process.stdout.write('\n')
  return false
}

async function maybeSpawnRelay() {
  const occupied = await checkPort(8000)
  if (occupied) {
    console.log('RelayFreeLLM already running on port 8000.')
    return
  }
  const relayDir = (process.env.RELAY_DIR || '/Users/rohanbalasubramanian/Documents/RelayFreeLLM')
    .replace(/^~/, homedir())
  console.log(`Spawning RelayFreeLLM from ${relayDir} ...`)
  const relay = spawn('python3', ['-m', 'src.server'], { cwd: relayDir, stdio: 'inherit' })
  relay.on('error', err => { throw new Error(`Failed to start RelayFreeLLM: ${err.message}`) })
  process.stdout.write('Waiting for server readiness')
  const ready = await waitForReady()
  if (!ready) throw new Error('RelayFreeLLM did not become ready within 30s.')
  console.log('RelayFreeLLM is ready.\n')
}

// ─── Prompt & LaTeX Helpers ───────────────────────────────────────────────────

function buildResumePrompt(jobDescription, sweTex, skills) {
  const skillsBlock = Object.entries(skills)
    .map(([name, content]) => `<${name}>\n${content}\n</${name}>`)
    .join('\n\n')

  return `You are editing a LaTeX resume. Your output must be the complete, valid LaTeX source — nothing else.

Here is the current resumes/swe.tex:
<swe_tex>
${sweTex}
</swe_tex>

Here are the skill pools:
${skillsBlock}

The target job description is:
<job_description>
${jobDescription.trim()}
</job_description>

Update ONLY the Technical Skills section with these strict constraints:
- Exactly 5 skill headings total.
- Row 1 heading must be "Languages".
- Rows 2, 3, and 4: choose headings that best match the job description (e.g., "Frameworks", "Developer Tools", "Libraries", "Cloud \\& DevOps").
- Row 5 heading must be "Courses". All course names must fit on a single physical line — do NOT insert a \\\\ line break within the Courses row. The total visible characters of the Courses line must be strictly between 150 and 200.
- Pull skills from the skill pools that match keywords in the job description.
- Add any critical missing skills explicitly required by the job description (e.g., Docker, Kubernetes) if not already present.
- Every physical line of skills content (ignoring LaTeX markup like \\textbf{}, \\item, \\\\) must produce strictly between 60 and 105 characters of visible PDF text. If a line is too short, pack it with more relevant, matching keywords from the skill pools to maximize ATS keyword density, but do not exceed 105 characters.
- CRITICAL: In LaTeX, the ampersand character & is a reserved alignment tab. Always write it as \\& inside \\textbf{} headings and skill content (e.g., \\textbf{Cloud \\& DevOps}, never \\textbf{Cloud & DevOps}).
- Do not modify any other section.

Output the complete modified swe.tex to stdout. Output ONLY the raw LaTeX — no explanation, no markdown fences, no commentary.`
}

function extractLatex(output) {
  const start = output.indexOf('\\documentclass')
  const end   = output.lastIndexOf('\\end{document}')
  if (start === -1 || end === -1) return null
  return output.slice(start, end + '\\end{document}'.length)
}

async function readSkillFiles() {
  const files = await fs.readdir(RESUMES_DIR)
  const entries = await Promise.all(
    files
      .filter(f => f.startsWith('skills_') && f.endsWith('.txt'))
      .map(async f => [f, await fs.readFile(path.join(RESUMES_DIR, f), 'utf8')])
  )
  return Object.fromEntries(entries)
}

// ─── API Call ─────────────────────────────────────────────────────────────────

async function callModel(model, prompt) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS)
  const t0 = Date.now()
  try {
    const res = await fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 16384,
      }),
      signal: controller.signal,
    })
    const latency = Date.now() - t0
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { latency, content: null, error: `HTTP ${res.status}: ${text.slice(0, 300)}` }
    }
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content ?? null
    if (!content) return { latency, content: null, error: 'Empty or missing choices in response' }
    return { latency, content, error: null }
  } catch (err) {
    return { latency: Date.now() - t0, content: null, error: err.message }
  } finally {
    clearTimeout(timer)
  }
}

// ─── LaTeX Parsing ────────────────────────────────────────────────────────────

// ─── Production Trimmer (ported from server.js) ───────────────────────────────

function visibleLength(latexLine) {
  return latexLine
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\item\s*/g, '')
    .replace(/\\\\$/, '')
    .replace(/\\&/g, '&')
    .replace(/\\[a-zA-Z]+\{[^}]*\}/g, '')
    .replace(/\\[a-zA-Z]+/g, '')
    .length
}

function trimToItem(text, maxLen) {
  if (text.length <= maxLen) return text
  const cut = text.lastIndexOf(',', maxLen)
  return cut > 0 ? text.slice(0, cut) : text.slice(0, maxLen)
}

function applySkillsLineTrimmerWithLog(tex, trimLog, maxVisible = 105) {
  const start = tex.indexOf('\\section{Technical Skills}')
  if (start === -1) return tex
  const end = tex.indexOf('\\section{', start + 1)
  const boundary = end === -1 ? tex.length : end
  const lines = tex.slice(start, boundary).split('\n')
  let contentRow = 0
  const trimmed = lines.map(line => {
    if (!line.includes('\\textbf{')) return line
    contentRow++
    if (contentRow < 2) return line
    const limit = contentRow <= 4 ? maxVisible : 200
    if (visibleLength(line) <= limit) return line
    const originalLine = line
    const m = line.match(/^(.*?\\textbf\{[^}]+\}\{)(.*?)(\}\s*(?:\\\\)?)\s*$/)
    let result
    if (!m) {
      result = trimToItem(line, line.length - (visibleLength(line) - limit))
    } else {
      const trimmedBody = trimToItem(m[2], limit - visibleLength(m[1])).replace(/,\s*$/, '')
      result = m[1] + trimmedBody + m[3]
    }
    trimLog.push({ original: originalLine, trimmed: result })
    return result
  })
  return tex.slice(0, start) + trimmed.join('\n') + tex.slice(boundary)
}

// ─── Token Estimation ─────────────────────────────────────────────────────────

function estimateTokens(text) {
  return Math.round(text.length / 4)
}

// ─── Constraint Validation ────────────────────────────────────────────────────

const validateBeforeTrim = validateRows
const validateAfterTrim = validateRows

// ─── Report Rendering ─────────────────────────────────────────────────────────

const JD_SHORT = {
  'google-swe-systems':     'Google SWE (Systems)',
  'amazon-ml-engineer':     'Amazon ML (Gamer AI)',
  'uhg-cloud-architect':    'UHG Cloud Architect',
  'cognizant-embedded-cpp': 'Cognizant C++ (Embedded)',
}

function renderSummaryTable(allResults) {
  const header = [
    '| Rank | Model | JD | Latency (s) | Tokens In | Tokens Out | API | Before | After | Final |',
    '|------|-------|----|------------:|----------:|-----------:|-----|--------|-------|-------|',
  ]
  const rows = allResults.map(r => {
    const latency = (r.latency / 1000).toFixed(2)
    const apiIcon = r.error ? '❌' : '✅'
    const before  = r.validationBefore ? (r.validationBefore.passed ? '✅' : '❌') : '—'
    const after   = r.validationAfter  ? (r.validationAfter.passed  ? '✅' : '❌') : '—'
    const final   = r.finalPass ? '✅ PASS' : (r.error ? '—' : '❌ FAIL')
    const jd = JD_SHORT[r.jd.id] ?? r.jd.label
    return `| ${r.rank} | \`${r.model}\` | ${jd} | ${latency} | ${r.inputTokens} | ${r.outputTokens} | ${apiIcon} | ${before} | ${after} | ${final} |`
  })
  return [...header, ...rows].join('\n')
}

function renderValidationTable(v) {
  if (!v) return '_Validation unavailable._\n'
  const lines = [
    '| Row | Line | Heading | Visible Text (truncated) | Length | Check |',
    '|-----|------|---------|--------------------------|-------:|-------|',
  ]
  v.lines.forEach(l => {
    const text = l.stripped.length > 68 ? l.stripped.slice(0, 65) + '...' : l.stripped
    lines.push(`| ${l.rowIndex} | ${l.lineIndex} | ${l.heading} | ${text} | ${l.length} | ${l.pass ? '✅' : '❌'} |`)
  })
  return lines.join('\n') + '\n'
}

function renderModelSection(rank, model, jobResults) {
  const out = []
  out.push(`## Rank ${rank}: \`${model}\`\n`)

  for (const r of jobResults) {
    out.push(`### ${r.jd.label}\n`)
    out.push(`**JD Size:** ${r.jd.charCount.toLocaleString()} chars  |  **Latency:** ${(r.latency / 1000).toFixed(2)} s  |  **Tokens In:** ~${r.inputTokens.toLocaleString()}  |  **Tokens Out:** ~${r.outputTokens.toLocaleString()}\n`)

    if (r.error) {
      out.push('**API Status:** ❌ Error\n')
      out.push('```')
      out.push(r.error.slice(0, 500))
      out.push('```\n')
      out.push('---\n')
      continue
    }

    if (!r.skillsBlock) {
      out.push('**API Status:** ✅ Success  |  ⚠️ `\\section{Technical Skills}` not found in LLM output.\n')
      out.push('---\n')
      continue
    }

    // Before trim
    const vb = r.validationBefore
    const beforeSummary = vb.passed
      ? '✅ PASS'
      : `❌ FAIL — ${vb.violations.length} violation${vb.violations.length !== 1 ? 's' : ''}: row1=${vb.row1IsLanguages ? '✓' : '✗'}, row5=${vb.row5IsCourses ? '✓' : '✗'}, 1line=${vb.row5IsOneLine ? '✓' : '✗'}`
    out.push(`**Constraint Check BEFORE Trim:** ${beforeSummary}\n`)
    out.push(renderValidationTable(vb))

    // Trim log
    if (r.trimLog.length === 0) {
      out.push('**Trim Log:** No lines trimmed by production trimmer.\n')
    } else {
      out.push(`**Trim Log:** ${r.trimLog.length} line${r.trimLog.length !== 1 ? 's' : ''} trimmed by production trimmer.\n`)
      out.push('| Original (truncated) | Trimmed (truncated) |')
      out.push('|----------------------|---------------------|')
      r.trimLog.forEach(t => {
        const orig = (t.original.length > 75 ? t.original.slice(0, 72) + '...' : t.original).replace(/\|/g, '‖')
        const trm  = (t.trimmed.length  > 75 ? t.trimmed.slice(0, 72)  + '...' : t.trimmed ).replace(/\|/g, '‖')
        out.push(`| \`${orig}\` | \`${trm}\` |`)
      })
      out.push('')
    }

    // After trim
    const va = r.validationAfter
    if (va) {
      const afterSummary = va.passed
        ? '✅ PASS'
        : `❌ FAIL — ${va.violations.length} violation${va.violations.length !== 1 ? 's' : ''} remain`
      out.push(`**Constraint Check AFTER Trim:** ${afterSummary}\n`)
      if (!va.passed) out.push(renderValidationTable(va))
    } else {
      out.push('**Constraint Check AFTER Trim:** ⚠️ Could not re-extract skills block after trimmer.\n')
    }

    // LaTeX blocks
    out.push('**Generated Skills Block (raw LLM output):**\n')
    out.push('```latex')
    out.push(r.skillsBlock)
    out.push('```\n')

    if (r.trimLog.length > 0 && r.trimmedSkillsBlock) {
      out.push('**Skills Block (after production trimmer):**\n')
      out.push('```latex')
      out.push(r.trimmedSkillsBlock)
      out.push('```\n')
    }

    out.push('---\n')
  }

  return out.join('\n')
}

function buildReport(allResults) {
  const modelGroups = []
  let cur = null
  for (const r of allResults) {
    if (!cur || cur.rank !== r.rank) {
      cur = { rank: r.rank, model: r.model, jobResults: [] }
      modelGroups.push(cur)
    }
    cur.jobResults.push(r)
  }

  const apiSuccess = allResults.filter(r => !r.error).length
  const finalPass  = allResults.filter(r => r.finalPass).length

  return [
    '# Model Benchmark Report v2',
    '',
    `**Date:** ${new Date().toISOString()}`,
    `**Relay:** ${RELAY_URL}`,
    `**Models:** ${INTENT_HIERARCHY.length}  |  **JDs:** ${JOB_DESCRIPTIONS.length}  |  **Total Runs:** ${allResults.length}  |  **API Success:** ${apiSuccess}/${allResults.length}  |  **Final PASS:** ${finalPass}/${allResults.length}`,
    '',
    '## Master Performance Summary',
    '',
    renderSummaryTable(allResults),
    '',
    '---',
    '',
    '## Per-Model Details',
    '',
    ...modelGroups.map(g => renderModelSection(g.rank, g.model, g.jobResults)),
  ].join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== JSeek Model Benchmark v2 ===\n')
  await maybeSpawnRelay()
  console.log('Reading local files...')

  const [sweTex, skills] = await Promise.all([
    fs.readFile(path.join(RESUMES_DIR, 'swe.tex'), 'utf8'),
    readSkillFiles(),
  ])
  console.log(`Loaded swe.tex (${sweTex.length} chars), ${Object.keys(skills).length} skill files: ${Object.keys(skills).join(', ')}\n`)

  const totalRuns = INTENT_HIERARCHY.length * JOB_DESCRIPTIONS.length
  console.log(`Matrix: ${INTENT_HIERARCHY.length} models × ${JOB_DESCRIPTIONS.length} JDs = ${totalRuns} total runs\n`)

  JOB_DESCRIPTIONS.forEach((jd, i) => {
    console.log(`  JD${i + 1}: ${jd.label} (${jd.text.length.toLocaleString()} chars)`)
  })
  console.log()

  const allResults = []

  for (let mi = 0; mi < INTENT_HIERARCHY.length; mi++) {
    const model = INTENT_HIERARCHY[mi]

    for (let ji = 0; ji < JOB_DESCRIPTIONS.length; ji++) {
      const jd = JOB_DESCRIPTIONS[ji]
      const prompt = buildResumePrompt(jd.text, sweTex, skills)
      const inputTokens = estimateTokens(prompt)

      process.stdout.write(`[${mi + 1}/19][${ji + 1}/4] ${model} × ${JD_SHORT[jd.id]} ... `)

      let callResult
      try {
        callResult = await callModel(model, prompt)
      } catch (unexpectedErr) {
        callResult = { latency: 0, content: null, error: unexpectedErr.message }
      }
      const { latency, content, error } = callResult

      const entry = {
        rank: mi + 1,
        model,
        jd: { id: jd.id, label: jd.label, charCount: jd.text.length },
        latency,
        inputTokens,
        outputTokens: 0,
        error: error ?? null,
        skillsBlock: null,
        validationBefore: null,
        trimLog: [],
        trimmedSkillsBlock: null,
        validationAfter: null,
        finalPass: false,
      }

      if (!error && content) {
        entry.outputTokens = estimateTokens(content)
        const latex = extractLatex(content)

        if (latex) {
          entry.skillsBlock = extractSkillsBlock(latex)

          if (entry.skillsBlock) {
            const rowsBefore = parseSkillRows(entry.skillsBlock)
            entry.validationBefore = validateBeforeTrim(rowsBefore)

            const trimmedTex = applySkillsLineTrimmerWithLog(latex, entry.trimLog)
            entry.trimmedSkillsBlock = extractSkillsBlock(trimmedTex)

            if (entry.trimmedSkillsBlock) {
              const rowsAfter = parseSkillRows(entry.trimmedSkillsBlock)
              entry.validationAfter = validateAfterTrim(rowsAfter)
              entry.finalPass = entry.validationAfter.passed
            }
          }
        }
      }

      if (entry.error) {
        console.log(`❌ ${latency}ms | ${entry.error.slice(0, 80)}`)
      } else if (!entry.skillsBlock) {
        console.log(`⚠️  ${latency}ms | in=~${inputTokens} out=~${entry.outputTokens} | could not extract skills block`)
      } else {
        const before = entry.validationBefore?.passed ? 'PASS' : 'FAIL'
        const after  = entry.validationAfter?.passed  ? 'PASS' : 'FAIL'
        const trims  = entry.trimLog.length
        console.log(`✅ ${latency}ms | in=~${inputTokens} out=~${entry.outputTokens} | before=${before} after=${after} trim=${trims}`)
      }

      allResults.push(entry)
    }
  }

  const apiSuccess = allResults.filter(r => !r.error).length
  const finalPass  = allResults.filter(r => r.finalPass).length

  console.log(`\n${'='.repeat(55)}`)
  console.log(`Complete: ${apiSuccess}/${totalRuns} API success, ${finalPass}/${totalRuns} final PASS`)

  const report = buildReport(allResults)
  await fs.writeFile(REPORT_PATH, report, 'utf8')
  console.log(`Report written → ${REPORT_PATH}`)
}

main().catch(err => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
