import { getBug } from "./bug.js";
import { postAction } from "./client.js";
import { textToHtml } from "../html.js";

/**
 * Add a comment to a bug via a plain HTTP POST (no browser needed).
 *
 * ZenTao has no standalone "add comment" endpoint usable by every role
 * (action-comment is permission-gated), so a comment is attached through the
 * normal bug edit. ZenTao's bug->update resets any field that isn't posted
 * (product/module/severity… fall back to 0/empty), so we must echo the bug's
 * current values back unchanged and only add the comment. We pull those values
 * from the bug-view JSON, which returns them in the exact format the edit form
 * expects (product/module as ids, build as `trunk`, etc.).
 *
 * `lastEditedDate` is deliberately omitted — sending a stale one trips ZenTao's
 * concurrent-edit guard; an empty value skips the check entirely.
 */
export async function addComment(
  bugId: number,
  comment: string,
): Promise<{ result: string }> {
  const bug = await getBug(bugId);

  const body: Record<string, unknown> = {
    title: bug.title,
    product: bug.product,
    module: bug.module,
    project: bug.project,
    // Links ZenTao resets to 0 when omitted — echo them so they survive the edit.
    branch: bug.branch,
    plan: bug.plan,
    story: bug.story,
    task: bug.task,
    type: bug.type,
    severity: bug.severity,
    pri: bug.pri,
    status: bug.status,
    assignedTo: bug.assignedTo,
    deadline: bug.deadline,
    os: bug.os,
    browser: bug.browser,
    keywords: bug.keywords,
    steps: bug.steps,
    duplicateBug: bug.duplicateBug,
    // Multi-value fields ZenTao joins with commas — keep current values.
    "openedBuild[]": bug.openedBuild ? [bug.openedBuild] : [],
    // Preserve resolution state so editing an already-resolved bug is non-destructive.
    resolution: bug.resolution,
    resolvedBy: bug.resolvedBy,
    resolvedDate: bug.resolvedDate,
    resolvedBuild: bug.resolvedBuild,
    closedBy: bug.closedBy,
    closedDate: bug.closedDate,
    comment: textToHtml(comment),
  };

  await postAction(`bug-edit-${bugId}.json`, body);
  return { result: "success" };
}
