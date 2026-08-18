/**
 * PDF Report Service
 *
 * Renders a professional, business-friendly PDF report for a completed
 * meeting: header block (title / date / duration / participants), executive
 * summary, objective, discussion points, decisions, action items, Q&A,
 * follow-ups, risks, timeline of important moments (chapters) and per-speaker
 * discussion. Deliberately does NOT include the raw transcript.
 */
import PDFDocument from 'pdfkit';
import type { MeetingReportData } from './meetingService';
import type { ActionItem, Chapter, QAPair, SpeakerInsight } from './aiPipelineService';

// ── Palette / layout ─────────────────────────────────────────────────────────
const INK = '#1f2430';
const MUTED = '#6b7280';
const ACCENT = '#e8590c';
const RULE = '#e5e7eb';
const CARD_BG = '#f7f7f9';

const MARGIN = 54;

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('en-US', {
    weekday: 'short', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function generateMeetingPdf(data: MeetingReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: `Meeting Report — ${data.title || data.meetingCode}`,
        Author: 'MeetMaster',
        Subject: 'AI-generated meeting report',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', c => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - MARGIN * 2;

    // Keep a section from starting in the page's last few lines.
    const ensureRoom = (needed = 90) => {
      if (doc.y > doc.page.height - MARGIN - needed) doc.addPage();
    };

    const sectionTitle = (title: string) => {
      ensureRoom();
      doc.moveDown(1);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(ACCENT)
        .text(title.toUpperCase(), { characterSpacing: 0.8 });
      doc.moveTo(MARGIN, doc.y + 3).lineTo(MARGIN + pageWidth, doc.y + 3)
        .lineWidth(0.7).strokeColor(RULE).stroke();
      doc.moveDown(0.6);
      doc.font('Helvetica').fontSize(10).fillColor(INK);
    };

    const paragraph = (text: string) => {
      doc.font('Helvetica').fontSize(10).fillColor(INK)
        .text(text, { lineGap: 2.5, paragraphGap: 6 });
    };

    const bullets = (items: string[], bullet = '•') => {
      for (const item of items) {
        ensureRoom(40);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text(bullet, MARGIN, y, { continued: false, width: 14 });
        doc.font('Helvetica').fontSize(10).fillColor(INK)
          .text(item, MARGIN + 16, y, { width: pageWidth - 16, lineGap: 2 });
        doc.moveDown(0.35);
        doc.x = MARGIN;
      }
    };

    // ── Header ────────────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 6).fill(ACCENT);
    doc.y = MARGIN;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('MEETMASTER MEETING REPORT', { characterSpacing: 1.2 });
    doc.moveDown(0.35);
    doc.font('Helvetica-Bold').fontSize(20).fillColor(INK)
      .text(data.title || `Meeting ${data.meetingCode}`, { lineGap: 2 });
    doc.moveDown(0.6);

    // Meta card
    const metaTop = doc.y;
    const metaRows: [string, string][] = [
      ['Date', fmtDate(data.startedAt)],
      ['Duration', fmtDuration(data.durationMs)],
      ['Meeting code', data.meetingCode],
      ['Participants', data.participants.length > 0 ? data.participants.join(', ') : '—'],
    ];
    if (data.language) metaRows.push(['Language', data.language.toUpperCase()]);
    // measure card height
    doc.font('Helvetica').fontSize(9.5);
    let cardH = 16;
    for (const [, v] of metaRows) {
      cardH += Math.max(
        doc.heightOfString(v, { width: pageWidth - 120 - 24 }),
        12,
      ) + 5;
    }
    doc.rect(MARGIN, metaTop, pageWidth, cardH).fill(CARD_BG);
    let rowY = metaTop + 10;
    for (const [k, v] of metaRows) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(MUTED).text(k.toUpperCase(), MARGIN + 12, rowY, { width: 108 });
      doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(v, MARGIN + 120, rowY, { width: pageWidth - 120 - 24 });
      rowY = Math.max(doc.y, rowY + 12) + 5;
    }
    doc.x = MARGIN;
    doc.y = metaTop + cardH + 8;

    // ── Objective / outcome ───────────────────────────────────────────────────
    if (data.meetingObjective) {
      sectionTitle('Meeting Objective');
      paragraph(data.meetingObjective);
    }

    if (data.summary) {
      sectionTitle('Executive Summary');
      paragraph(data.summary);
    }

    if (data.discussionPoints.length > 0) {
      sectionTitle('Key Discussion Points');
      bullets(data.discussionPoints);
    }

    if (data.decisions.length > 0) {
      sectionTitle('Decisions Made');
      bullets(data.decisions);
    }

    const actionItems = data.actionItems as ActionItem[];
    if (actionItems.length > 0) {
      sectionTitle('Action Items');
      actionItems.forEach((a, i) => {
        ensureRoom(46);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text(`${i + 1}.`, MARGIN, y, { width: 18 });
        doc.font('Helvetica').fontSize(10).fillColor(INK)
          .text(a.task, MARGIN + 20, y, { width: pageWidth - 20, lineGap: 2 });
        const details = [
          a.owner ? `Owner: ${a.owner}` : 'Owner: unassigned',
          a.dueHint ? `Due: ${a.dueHint}` : null,
        ].filter(Boolean).join('    ');
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED)
          .text(details, MARGIN + 20, doc.y + 1, { width: pageWidth - 20 });
        doc.moveDown(0.5);
        doc.x = MARGIN;
      });
    }

    const qa = (data.qaPairs ?? []) as QAPair[];
    if (qa.length > 0) {
      sectionTitle('Questions & Answers');
      for (const pair of qa) {
        ensureRoom(56);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
          .text(`Q: ${pair.question}${pair.askedBy ? `  (${pair.askedBy})` : ''}`, MARGIN, y, { width: pageWidth, lineGap: 2 });
        doc.font('Helvetica').fontSize(10).fillColor(pair.answer ? INK : MUTED)
          .text(pair.answer ? `A: ${pair.answer}` : 'A: Not answered during the meeting.', MARGIN + 12, doc.y + 1, { width: pageWidth - 12, lineGap: 2 });
        doc.moveDown(0.55);
        doc.x = MARGIN;
      }
    }

    if (data.risks.length > 0) {
      sectionTitle('Risks & Blockers');
      bullets(data.risks, '!');
    }

    if (data.followUps.length > 0) {
      sectionTitle('Follow-up Items');
      bullets(data.followUps);
    }

    if (data.nextMeeting) {
      sectionTitle('Next Meeting');
      paragraph(data.nextMeeting);
    }

    const chapters = (data.chapters ?? []) as Chapter[];
    if (chapters.length > 0) {
      sectionTitle('Timeline of Key Moments');
      for (const c of chapters) {
        ensureRoom(42);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(ACCENT)
          .text(fmtClock(c.startMs), MARGIN, y + 1, { width: 40 });
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
          .text(c.title, MARGIN + 46, y, { width: pageWidth - 46 });
        if (c.summary) {
          doc.font('Helvetica').fontSize(9).fillColor(MUTED)
            .text(c.summary, MARGIN + 46, doc.y + 1, { width: pageWidth - 46, lineGap: 1.5 });
        }
        doc.moveDown(0.45);
        doc.x = MARGIN;
      }
    }

    const speakers = (data.speakerInsights ?? []) as SpeakerInsight[];
    if (speakers.length > 0) {
      sectionTitle('Speaker-wise Discussion');
      for (const sp of speakers) {
        ensureRoom(60);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(sp.name);
        doc.moveDown(0.15);
        const sub = (label: string, items: string[]) => {
          if (items.length === 0) return;
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text(label.toUpperCase(), { characterSpacing: 0.5 });
          bullets(items, '–');
        };
        sub('Contributions', sp.contributions);
        sub('Ownership', sp.ownership);
        sub('Collaboration', sp.collaboration);
        doc.moveDown(0.4);
      }
    }

    if (data.outcome) {
      sectionTitle('Overall Outcome');
      paragraph(data.outcome);
    }

    // ── Footer on every page ──────────────────────────────────────────────────
    // The footer sits inside the bottom margin (page.height - 32 < page.height -
    // MARGIN), so PDFKit's auto page-break logic treats every footer draw as an
    // overflow and silently appends a BLANK page after each one. Temporarily
    // zeroing the bottom margin while drawing the footer disables that check —
    // the standard PDFKit idiom for margin-area footers — without affecting the
    // body content already laid out above.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const originalBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const bottom = doc.page.height - 32;
      doc.font('Helvetica').fontSize(8).fillColor(MUTED);
      doc.text(
        `Generated by MeetMaster · ${fmtDate(new Date())}`,
        MARGIN, bottom, { width: pageWidth / 2, lineBreak: false },
      );
      doc.text(
        `Page ${i - range.start + 1} of ${range.count}`,
        MARGIN + pageWidth / 2, bottom, { width: pageWidth / 2, align: 'right', lineBreak: false },
      );
      doc.page.margins.bottom = originalBottomMargin;
    }

    doc.end();
  });
}
