"use client";

import * as React from "react";
import {
  CheckCircle2,
  GitPullRequestArrow,
  Loader2,
  MessageSquarePlus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { Comment, ReviewRequest, SpecVersion } from "@/lib/domain/types";
import { studioApi } from "@/lib/client/api";
import { describePointer } from "@/lib/core/openapi/pointer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";

const STATUS_TONE = {
  open: "info",
  approved: "ok",
  changes_requested: "warn",
  merged: "accent",
  closed: "neutral",
} as const;

export function ReviewView({
  specId,
  versions,
  comments: initialComments,
  reviews: initialReviews,
  pointers,
}: {
  specId: string;
  versions: SpecVersion[];
  comments: Comment[];
  reviews: ReviewRequest[];
  pointers: { pointer: string; label: string }[];
}) {
  const [comments, setComments] = React.useState(initialComments);
  const [reviews, setReviews] = React.useState(initialReviews);
  const [busy, setBusy] = React.useState(false);

  const [pointer, setPointer] = React.useState(pointers[0]?.pointer ?? "");
  const [body, setBody] = React.useState("");

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [versionId, setVersionId] = React.useState(versions[0]?.id ?? "");
  const [baseVersionId, setBaseVersionId] = React.useState(versions[1]?.id ?? "");

  const addComment = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const result = await studioApi.addComment(specId, {
        pointer,
        body,
        versionId: versions[0]?.id ?? null,
      });
      setComments((previous) => [...previous, result.comment]);
      setBody("");
      toast.success("Comment added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the comment.");
    } finally {
      setBusy(false);
    }
  };

  const toggleResolved = async (comment: Comment): Promise<void> => {
    try {
      const result = await studioApi.updateComment(specId, comment.id, {
        resolved: !comment.resolved,
      });
      setComments((previous) =>
        previous.map((item) => (item.id === comment.id ? result.comment : item)),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the comment.");
    }
  };

  const createReview = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!title.trim() || !versionId) return;
    setBusy(true);
    try {
      const result = await studioApi.createReview(specId, {
        title,
        description,
        versionId,
        baseVersionId: baseVersionId || null,
      });
      setReviews((previous) => [result.review, ...previous]);
      setTitle("");
      setDescription("");
      toast.success("Review requested");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the review.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (
    review: ReviewRequest,
    decision: "approved" | "changes_requested",
  ): Promise<void> => {
    setBusy(true);
    try {
      const result = await studioApi.reviewDecision(specId, review.id, { decision, note: "" });
      setReviews((previous) =>
        previous.map((item) => (item.id === review.id ? result.review : item)),
      );
      toast.success(decision === "approved" ? "Approved" : "Changes requested");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record the decision.");
    } finally {
      setBusy(false);
    }
  };

  const merge = async (review: ReviewRequest): Promise<void> => {
    setBusy(true);
    try {
      const result = await studioApi.reviewDecision(specId, review.id, { status: "merged" });
      setReviews((previous) =>
        previous.map((item) => (item.id === review.id ? result.review : item)),
      );
      toast.success("Review merged");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "This review cannot be merged yet.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 p-6 lg:grid-cols-2">
      <div className="space-y-5">
        <Panel>
          <PanelHeader>
            <PanelTitle>Request a review</PanelTitle>
          </PanelHeader>
          <PanelBody>
            <form onSubmit={(event) => void createReview(event)} className="space-y-3">
              <Field label="Title">
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Add cursor pagination to /orders"
                />
              </Field>
              <Field label="Summary of the change">
                <Textarea
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What changed and why it matters to consumers."
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Proposed version">
                  <Select value={versionId} onChange={(event) => setVersionId(event.target.value)}>
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        v{version.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Compared against">
                  <Select
                    value={baseVersionId}
                    onChange={(event) => setBaseVersionId(event.target.value)}
                  >
                    <option value="">None</option>
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        v{version.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button type="submit" variant="primary" size="sm" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <GitPullRequestArrow />}
                Request review
              </Button>
            </form>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Review requests</PanelTitle>
            <Badge tone="neutral">{reviews.length}</Badge>
          </PanelHeader>
          {reviews.length === 0 ? (
            <EmptyState
              icon={<GitPullRequestArrow />}
              title="No reviews yet"
              description="Request a review to gate a change behind approval before publishing."
            />
          ) : (
            <ul className="divide-line/70 divide-y">
              {reviews.map((review) => (
                <li key={review.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ink text-sm font-medium">{review.title}</span>
                    <Badge tone={STATUS_TONE[review.status]}>
                      {review.status.replace("_", " ")}
                    </Badge>
                  </div>
                  {review.description ? (
                    <p className="text-ink-muted mt-1.5 text-xs leading-relaxed">
                      {review.description}
                    </p>
                  ) : null}
                  <p className="text-ink-subtle mt-1.5 text-[11px]">
                    Requested by {review.requestedByName} ·{" "}
                    {new Date(review.createdAt).toLocaleString()}
                  </p>

                  {review.decisions.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {review.decisions.map((decision, index) => (
                        <li
                          key={index}
                          className="text-ink-muted flex items-center gap-1.5 text-[11px]"
                        >
                          {decision.decision === "approved" ? (
                            <CheckCircle2 className="text-mint size-3" />
                          ) : (
                            <XCircle className="text-amber size-3" />
                          )}
                          {decision.reviewerName} {decision.decision.replace("_", " ")}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {review.status !== "merged" && review.status !== "closed" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void decide(review, "approved")}
                      >
                        <CheckCircle2 />
                        Approve
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void decide(review, "changes_requested")}
                      >
                        <XCircle />
                        Request changes
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy || review.status !== "approved"}
                        onClick={() => void merge(review)}
                      >
                        Merge
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel>
          <PanelHeader>
            <PanelTitle>Comment on the specification</PanelTitle>
          </PanelHeader>
          <PanelBody>
            <form onSubmit={(event) => void addComment(event)} className="space-y-3">
              <Field
                label="Anchor"
                hint="Comments are pinned to a JSON Pointer so they survive edits elsewhere."
              >
                <Select value={pointer} onChange={(event) => setPointer(event.target.value)}>
                  {pointers.map((entry) => (
                    <option key={entry.pointer} value={entry.pointer}>
                      {entry.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Comment">
                <Textarea
                  rows={3}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="This response should document 409 for duplicate idempotency keys."
                />
              </Field>
              <Button type="submit" variant="secondary" size="sm" disabled={busy}>
                <MessageSquarePlus />
                Add comment
              </Button>
            </form>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Discussion</PanelTitle>
            <Badge tone="neutral">
              {comments.filter((comment) => !comment.resolved).length} open
            </Badge>
          </PanelHeader>
          {comments.length === 0 ? (
            <EmptyState
              icon={<MessageSquarePlus />}
              title="No comments yet"
              description="Pin feedback to a specific operation, schema or response."
            />
          ) : (
            <ul className="divide-line/70 divide-y">
              {comments.map((comment) => (
                <li key={comment.id} className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-ink text-xs font-medium">{comment.authorName}</span>
                    <span className="text-ink-subtle text-[11px]">
                      {new Date(comment.createdAt).toLocaleString()}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 px-1.5 text-[10px]"
                      onClick={() => void toggleResolved(comment)}
                    >
                      {comment.resolved ? "Reopen" : "Resolve"}
                    </Button>
                  </div>
                  <p
                    className={
                      comment.resolved
                        ? "text-ink-subtle mt-1 text-xs leading-relaxed line-through"
                        : "text-ink-muted mt-1 text-xs leading-relaxed"
                    }
                  >
                    {comment.body}
                  </p>
                  <p className="text-ink-subtle mt-1 font-mono text-[10px]">
                    {describePointer(comment.pointer)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
