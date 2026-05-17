/**
 * Thin compatibility wrapper around the AI pipeline.
 * Kept so external callers expecting the old `generateSummary` shape continue to work.
 * Prefer importing `runPipeline` from `./aiPipelineService` directly for new code.
 */
import { runPipeline, type PipelineSegment } from './aiPipelineService';

export interface MeetingSummary {
  summary: string;
  keyInsights: string[];
  detailedRewrite: string;
  importantPoints: string[];
}

export async function generateSummary(
  segments: PipelineSegment[],
  title?: string,
): Promise<MeetingSummary> {
  const r = await runPipeline(segments, title);
  return {
    summary: r.summary,
    keyInsights: r.keyInsights,
    detailedRewrite: r.detailedRewrite,
    importantPoints: r.importantPoints,
  };
}