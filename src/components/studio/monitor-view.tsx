"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Loader2 } from "lucide-react";
import type { ApiProject } from "@/lib/domain/types";
import type { MetricsOverview } from "@/lib/core/telemetry/metrics";
import { studioApi } from "@/lib/client/api";
import { Badge, MethodBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { EmptyState, Stat } from "@/components/ui/misc";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { PageHeader } from "@/components/studio/shell";

const WINDOWS = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const STATUS_COLOR: Record<string, string> = {
  "2xx": "var(--color-mint)",
  "3xx": "var(--color-cyan)",
  "4xx": "var(--color-amber)",
  "5xx": "var(--color-rose)",
  "0xx": "var(--color-ink-subtle)",
};

export function MonitorView({
  specs,
  initialOverview,
}: {
  specs: ApiProject[];
  initialOverview: MetricsOverview;
}) {
  const [specId, setSpecId] = React.useState<string>("");
  const [window, setWindow] = React.useState("24h");
  const [overview, setOverview] = React.useState(initialOverview);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await studioApi.metrics({ window, ...(specId ? { specId } : {}) });
      setOverview(result.overview);
    } finally {
      setLoading(false);
    }
  }, [specId, window]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const series = overview.buckets.map((bucket) => ({
    at: new Date(bucket.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    requests: bucket.requests,
    errors: bucket.errors,
    p95: bucket.p95,
  }));

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Monitoring"
        description="Latency, availability and endpoint popularity from mock traffic, the API client and any external collector posting to /api/metrics."
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={specId}
              onChange={(event) => setSpecId(event.target.value)}
              className="h-9 w-48 text-xs"
            >
              <option value="">All APIs</option>
              {specs.map((spec) => (
                <option key={spec.id} value={spec.id}>
                  {spec.name}
                </option>
              ))}
            </Select>
            <Select
              value={window}
              onChange={(event) => setWindow(event.target.value)}
              className="h-9 w-40 text-xs"
            >
              {WINDOWS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>
            {loading ? <Loader2 className="text-ink-subtle size-4 animate-spin" /> : null}
          </div>
        }
      />

      <div className="flex-1 space-y-5 p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Requests" value={overview.requests.toLocaleString()} />
          <Stat
            label="Availability"
            value={`${overview.availability}%`}
            tone={
              overview.availability >= 99.5 ? "ok" : overview.availability >= 98 ? "warn" : "danger"
            }
          />
          <Stat
            label="Error rate"
            value={`${overview.errorRate}%`}
            tone={overview.errorRate <= 1 ? "ok" : overview.errorRate <= 5 ? "warn" : "danger"}
          />
          <Stat
            label="p95 latency"
            value={`${overview.latency.p95}ms`}
            hint={`p50 ${overview.latency.p50}ms`}
          />
          <Stat
            label="p99 latency"
            value={`${overview.latency.p99}ms`}
            hint={`max ${overview.latency.max}ms`}
          />
        </div>

        {overview.requests === 0 ? (
          <Panel>
            <EmptyState
              icon={<Activity />}
              title="No traffic recorded yet"
              description="Call a mock endpoint or send a request from the API client and it will appear here within seconds."
            />
          </Panel>
        ) : (
          <>
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel>
                <PanelHeader>
                  <PanelTitle>Requests and errors</PanelTitle>
                  <Badge tone="neutral">{overview.buckets.length} buckets</Badge>
                </PanelHeader>
                <PanelBody className="h-64 p-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                      <defs>
                        <linearGradient id="requestsFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.55} />
                          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="var(--color-line)"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="at"
                        tick={{ fontSize: 10, fill: "var(--color-ink-subtle)" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "var(--color-ink-subtle)" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <RechartsTooltip content={<ChartTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="requests"
                        stroke="var(--color-accent)"
                        strokeWidth={2}
                        fill="url(#requestsFill)"
                      />
                      <Area
                        type="monotone"
                        dataKey="errors"
                        stroke="var(--color-rose)"
                        strokeWidth={1.5}
                        fill="transparent"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </PanelBody>
              </Panel>

              <Panel>
                <PanelHeader>
                  <PanelTitle>p95 latency</PanelTitle>
                  <Badge tone="neutral">ms</Badge>
                </PanelHeader>
                <PanelBody className="h-64 p-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                      <defs>
                        <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-cyan)" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="var(--color-cyan)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="var(--color-line)"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="at"
                        tick={{ fontSize: 10, fill: "var(--color-ink-subtle)" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "var(--color-ink-subtle)" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <RechartsTooltip content={<ChartTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="p95"
                        stroke="var(--color-cyan)"
                        strokeWidth={2}
                        fill="url(#latencyFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </PanelBody>
              </Panel>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <Panel>
                <PanelHeader>
                  <PanelTitle>Endpoint popularity</PanelTitle>
                  <Badge tone="neutral">{overview.endpoints.length}</Badge>
                </PanelHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-line text-ink-subtle border-b text-[11px] tracking-wider uppercase">
                      <tr>
                        <th className="px-5 py-2 font-medium">Endpoint</th>
                        <th className="px-3 py-2 font-medium">Requests</th>
                        <th className="px-3 py-2 font-medium">Errors</th>
                        <th className="px-3 py-2 font-medium">Avg</th>
                        <th className="px-5 py-2 font-medium">p95</th>
                      </tr>
                    </thead>
                    <tbody className="divide-line/70 divide-y">
                      {overview.endpoints.map((endpoint) => (
                        <tr key={endpoint.key}>
                          <td className="flex items-center gap-2 px-5 py-2">
                            <MethodBadge method={endpoint.method} />
                            <code className="text-ink truncate font-mono text-[11px]">
                              {endpoint.path}
                            </code>
                          </td>
                          <td className="text-ink-muted px-3 py-2 font-mono">
                            {endpoint.requests}
                          </td>
                          <td className="text-ink-muted px-3 py-2 font-mono">
                            {endpoint.errors}{" "}
                            <span className="text-ink-subtle">({endpoint.errorRate}%)</span>
                          </td>
                          <td className="text-ink-muted px-3 py-2 font-mono">
                            {endpoint.averageMs}ms
                          </td>
                          <td className="text-ink-muted px-5 py-2 font-mono">{endpoint.p95}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel>
                <PanelHeader>
                  <PanelTitle>Status distribution</PanelTitle>
                </PanelHeader>
                <PanelBody className="h-56 p-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[...overview.statusDistribution]}
                      margin={{ top: 8, right: 8, bottom: 0, left: -22 }}
                    >
                      <CartesianGrid
                        stroke="var(--color-line)"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="status"
                        tick={{ fontSize: 10, fill: "var(--color-ink-subtle)" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "var(--color-ink-subtle)" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <RechartsTooltip content={<ChartTooltip />} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {overview.statusDistribution.map((entry) => (
                          <Cell
                            key={entry.status}
                            fill={STATUS_COLOR[entry.status] ?? "var(--color-accent)"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </PanelBody>
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-lg px-3 py-2 text-[11px]">
      <p className="text-ink-subtle mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-ink flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: entry.color }} />
          {entry.name}: <span className="font-mono">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}
