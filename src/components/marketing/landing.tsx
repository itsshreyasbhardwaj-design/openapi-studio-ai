"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  Boxes,
  FileCode2,
  Gauge,
  GitCompareArrows,
  Lock,
  Play,
  Server,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { GitHubIcon } from "@/components/ui/icons";

const FEATURES = [
  {
    icon: FileCode2,
    title: "Dual-mode designer",
    body: "A visual editor and a Monaco YAML/JSON editor over one document model. Edit either side; the other follows within a frame.",
  },
  {
    icon: ShieldCheck,
    title: "Validation that teaches",
    body: "Structural validation, a quality linter and an OWASP API Top 10 analyser — every finding carries a JSON Pointer and a fix.",
  },
  {
    icon: Bot,
    title: "AI that costs nothing",
    body: "Describe an API in a sentence. With an OpenRouter key it streams; without one, a deterministic design engine still produces a complete spec.",
  },
  {
    icon: Boxes,
    title: "Seven-language SDKs",
    body: "TypeScript, JavaScript, Python, Java, Go, C# and PHP — typed models, auth helpers, pagination, retries and real READMEs.",
  },
  {
    icon: Server,
    title: "Mock server in one click",
    body: "Every saved spec is instantly callable. Simulate latency, errors, and authentication failures from query parameters.",
  },
  {
    icon: TerminalSquare,
    title: "Built-in API client",
    body: "REST and GraphQL, environments, variables, assertions and chained collections that run as automated suites.",
  },
  {
    icon: GitCompareArrows,
    title: "Semantic versioning",
    body: "Diffs that understand meaning: removing a field is breaking, adding an optional one is not. Version impact is computed, not guessed.",
  },
  {
    icon: Gauge,
    title: "Monitoring built in",
    body: "Latency percentiles, error rates, availability and endpoint popularity from mock, client and collector traffic.",
  },
];

const PIPELINE = [
  { label: "Describe", detail: "Natural language brief" },
  { label: "Design", detail: "Visual + code, synchronised" },
  { label: "Validate", detail: "Structure, quality, security" },
  { label: "Mock", detail: "Callable in one click" },
  { label: "Test", detail: "Assertions and suites" },
  { label: "Ship", detail: "SDKs, docs, versions" },
];

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0 },
};

/**
 * The stagger container must declare *both* states. With only `show` defined,
 * `initial="hidden"` has nothing to resolve against and children never leave
 * their hidden variant.
 */
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

export function Landing() {
  return (
    <main className="flex flex-1 flex-col">
      <header className="border-line/60 bg-canvas/70 sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-sm font-semibold tracking-tight">OpenAPI Studio AI</span>
          </Link>
          <nav className="text-ink-muted hidden items-center gap-6 text-sm md:flex">
            <a href="#features" className="hover:text-ink transition-colors">
              Features
            </a>
            <a href="#pipeline" className="hover:text-ink transition-colors">
              Workflow
            </a>
            <a href="#open-source" className="hover:text-ink transition-colors">
              Open source
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <a
                href="https://github.com/itsshreyasbhardwaj-design/openapi-studio-ai"
                target="_blank"
                rel="noreferrer noopener"
              >
                <GitHubIcon className="size-4" />
                <span className="hidden sm:inline">GitHub</span>
              </a>
            </Button>
            <Button variant="primary" size="sm" asChild>
              <Link href="/dashboard">
                Open the studio <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="grid-lines pointer-events-none absolute inset-0" aria-hidden />
        <div className="mx-auto w-full max-w-7xl px-6 pt-20 pb-20 sm:pt-28">
          <motion.div initial="hidden" animate="show" variants={stagger} className="max-w-3xl">
            <motion.div variants={fadeUp}>
              <Badge tone="accent" className="mb-6">
                <Sparkles className="size-3" />
                MIT licensed · works with zero API keys
              </Badge>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              className="text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-6xl"
            >
              The API workbench that{" "}
              <span className="text-gradient">designs, proves and ships</span> your contract.
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="text-ink-muted mt-6 max-w-2xl text-base leading-relaxed text-pretty sm:text-lg"
            >
              Design OpenAPI 3.x visually or in raw YAML. Validate structure, quality and security
              in the same pass. Mock it, call it, test it, generate seven SDKs, publish the docs,
              and track every breaking change — from a single open-source application.
            </motion.p>

            <motion.div variants={fadeUp} className="mt-9 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" asChild>
                <Link href="/dashboard">
                  <Play />
                  Start designing
                </Link>
              </Button>
              <Button variant="secondary" size="lg" asChild>
                <Link href="/dashboard?demo=1">Load a sample API</Link>
              </Button>
            </motion.div>

            <motion.p
              variants={fadeUp}
              className="text-ink-subtle mt-5 flex items-center gap-2 text-xs"
            >
              <Lock className="size-3.5" />
              Runs locally with file-backed storage — no database, no accounts, no provider keys
              required.
            </motion.p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mt-16"
          >
            <HeroPreview />
          </motion.div>
        </div>
      </section>

      <section id="pipeline" className="mx-auto w-full max-w-7xl px-6 py-16">
        <h2 className="text-ink-subtle text-sm font-semibold tracking-[0.2em] uppercase">
          The whole loop
        </h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {PIPELINE.map((step, index) => (
            <div key={step.label} className="border-line bg-canvas-raised/50 rounded-xl border p-4">
              <span className="text-accent-soft font-mono text-[11px]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="text-ink mt-2 text-sm font-medium">{step.label}</p>
              <p className="text-ink-muted mt-1 text-xs leading-relaxed">{step.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-7xl px-6 py-16">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight">Everything the contract needs</h2>
          <p className="text-ink-muted mt-3">
            Not a Swagger UI wrapper. Each subsystem is a real engine with its own test suite,
            sharing one document model so they never disagree about your API.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.4, delay: (index % 4) * 0.06 }}
            >
              <Panel className="hover:border-accent/40 h-full p-5 transition-colors">
                <feature.icon className="text-accent-soft size-5" />
                <h3 className="text-ink mt-4 text-sm font-semibold">{feature.title}</h3>
                <p className="text-ink-muted mt-2 text-xs leading-relaxed">{feature.body}</p>
              </Panel>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="open-source" className="mx-auto w-full max-w-7xl px-6 pt-8 pb-24">
        <Panel strong className="overflow-hidden p-8 sm:p-12">
          <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center">
            <div className="max-w-xl">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Open source, and genuinely free to run
              </h2>
              <p className="text-ink-muted mt-3 text-sm leading-relaxed">
                MIT licensed. Clone it, run{" "}
                <code className="bg-canvas rounded px-1.5 py-0.5 font-mono text-xs">pnpm dev</code>,
                and every feature works: the AI assistant falls back to a deterministic design
                engine, storage falls back to a JSON file, and authentication falls back to a local
                identity. Add Supabase, Clerk and OpenRouter when you want the hosted experience.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-3">
              <Button variant="primary" size="lg" asChild>
                <a
                  href="https://github.com/itsshreyasbhardwaj-design/openapi-studio-ai"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <GitHubIcon className="size-4" />
                  Star on GitHub
                </a>
              </Button>
              <Button variant="secondary" size="lg" asChild>
                <Link href="/dashboard">Open the studio</Link>
              </Button>
            </div>
          </div>
        </Panel>
      </section>

      <footer className="border-line/60 border-t py-8">
        <div className="text-ink-subtle mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 px-6 text-xs sm:flex-row">
          <p>© {new Date().getFullYear()} OpenAPI Studio AI contributors · MIT licensed</p>
          <div className="flex items-center gap-5">
            <Link href="/dashboard" className="hover:text-ink transition-colors">
              Studio
            </Link>
            <a
              href="https://github.com/itsshreyasbhardwaj-design/openapi-studio-ai"
              className="hover:text-ink transition-colors"
              target="_blank"
              rel="noreferrer noopener"
            >
              Source
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function LogoMark() {
  return (
    <span className="from-accent to-cyan text-canvas relative grid size-7 place-items-center rounded-lg bg-gradient-to-br text-[13px] font-black">
      A
    </span>
  );
}

/** Static, hand-built preview of the designer — no screenshot dependency. */
function HeroPreview() {
  return (
    <Panel strong className="overflow-hidden">
      <div className="border-line flex items-center gap-2 border-b px-4 py-2.5">
        <span className="bg-rose/70 size-2.5 rounded-full" />
        <span className="bg-amber/70 size-2.5 rounded-full" />
        <span className="bg-mint/70 size-2.5 rounded-full" />
        <span className="text-ink-subtle ml-3 font-mono text-[11px]">orders-api.yaml · 3.1.0</span>
        <Badge tone="ok" className="ml-auto">
          Score 92
        </Badge>
        <Badge tone="accent">Security A</Badge>
      </div>

      <div className="bg-line grid gap-px lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="bg-canvas-raised/80 p-4">
          <p className="text-ink-subtle mb-3 text-[11px] tracking-wider uppercase">Operations</p>
          <ul className="space-y-1.5">
            {[
              ["GET", "/orders", "List orders"],
              ["POST", "/orders", "Create an order"],
              ["GET", "/orders/{orderId}", "Retrieve an order"],
              ["POST", "/orders/{orderId}/refund", "Refund an order"],
              ["GET", "/products", "List products"],
            ].map(([method, path, summary]) => (
              <li
                key={`${method}${path}`}
                className="hover:border-line hover:bg-surface/60 flex items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 transition-colors"
              >
                <span
                  className={`w-14 shrink-0 rounded border px-1 py-0.5 text-center font-mono text-[10px] font-bold ${
                    method === "GET"
                      ? "border-cyan/40 bg-cyan/10 text-cyan"
                      : "border-mint/40 bg-mint/10 text-mint"
                  }`}
                >
                  {method}
                </span>
                <span className="text-ink truncate font-mono text-xs">{path}</span>
                <span className="text-ink-subtle ml-auto hidden truncate text-[11px] sm:inline">
                  {summary}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <pre className="bg-canvas/80 text-ink-muted overflow-x-auto p-4 font-mono text-[11px] leading-relaxed">
          <code>{`paths:
  /orders:
    post:
      operationId: createOrder
      summary: Create an order
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/OrderCreate'
      responses:
        '201':
          description: The created order.
        '429':
          $ref: '#/components/responses/rate_limited'`}</code>
        </pre>
      </div>

      <div className="border-line text-ink-subtle flex flex-wrap items-center gap-4 border-t px-4 py-2.5 text-[11px]">
        <span>23 operations</span>
        <span>·</span>
        <span>0 errors</span>
        <span>·</span>
        <span>7 SDK targets</span>
        <span>·</span>
        <span className="text-mint">mock live</span>
      </div>
    </Panel>
  );
}
